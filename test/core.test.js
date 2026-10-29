import test from 'node:test';
import assert from 'node:assert';
import { validateDraft, AiExtractionSchema } from '../lib/schema.js';
import { redact, extractOffline } from '../lib/extract.js';
import { buildDemo } from '../lib/demo.js';
import { buildInsights } from '../lib/insights.js';

const today = '2026-10-25';
const good = { type: 'expense', amount: 450, currency: 'INR', category: 'Food & Dining', date: '2026-10-24' };

test('a complete draft is saveable', () => {
    const v = validateDraft(good, { today });
    assert.equal(v.canSave, true);
    assert.deepEqual(v.blocking, []);
});

test('missing amount and date block saving instead of being invented', () => {
    const v = validateDraft({ ...good, amount: null, date: null }, { today });
    assert.equal(v.canSave, false);
    assert.deepEqual(v.blocking, ['amount', 'date']);
    assert.equal(v.fields.amount.status, 'missing');
});

test('invalid values are rejected', () => {
    assert.equal(validateDraft({ ...good, amount: -5 }, { today }).fields.amount.status, 'invalid');
    assert.equal(validateDraft({ ...good, amount: 'abc' }, { today }).fields.amount.status, 'invalid');
    assert.equal(validateDraft({ ...good, date: '2026-02-30' }, { today }).fields.date.status, 'invalid');
    assert.equal(validateDraft({ ...good, date: '2027-01-01' }, { today }).fields.date.status, 'invalid');
    assert.equal(validateDraft({ ...good, category: 'Crypto' }, { today }).fields.category.status, 'invalid');
    assert.equal(validateDraft({ ...good, currency: 'XYZ' }, { today }).fields.currency.status, 'invalid');
});

test('missing currency is defaulted but flagged as assumed', () => {
    const v = validateDraft({ ...good, currency: null }, { today });
    assert.equal(v.fields.currency.value, 'INR');
    assert.equal(v.fields.currency.status, 'assumed');
    assert.equal(v.canSave, true);
});

test('large amounts are flagged for confirmation', () => {
    assert.equal(validateDraft({ ...good, amount: 25000 }, { today }).isLarge, true);
    assert.equal(validateDraft(good, { today }).isLarge, false);
});

test('sensitive data is redacted', () => {
    const r = redact('paid with 4111 1111 1111 1111, otp 482913, mail me at a@b.com or 9876543210');
    assert.ok(!/4111|482913|a@b\.com|9876543210/.test(r.text), r.text);
    assert.deepEqual(r.removed.sort(), ['card number', 'email address', 'one-time code', 'phone number']);
});

test('offline parser output matches the AI schema', () => {
    const out = extractOffline('Spent ₹450 on lunch at Barbeque Nation yesterday, paid by card', today);
    assert.ok(AiExtractionSchema.safeParse(out).success);
    assert.equal(out.amount, 450);
    assert.equal(out.currency, 'INR');
    assert.equal(out.date, '2026-10-24');
    assert.equal(out.category, 'Food & Dining');
    assert.equal(out.payment_method, 'card');
});

test('offline parser handles Indian formats and relative dates', () => {
    assert.equal(extractOffline('rent 1,20,000 last monday', today).amount, 120000);
    assert.equal(extractOffline('rent 1,20,000 last monday', today).date, '2026-10-19');
    assert.equal(extractOffline('salary 85k credited on 1st Oct', today).type, 'income');
    assert.equal(extractOffline('salary 85k credited on 1st Oct', today).amount, 85000);
    assert.equal(extractOffline('groceries 640 on 12/10', today).date, '2026-10-12');
});

test('non-financial text is recognised', () => {
    assert.equal(extractOffline('what will the weather be tomorrow?', today).is_financial_transaction, false);
});

test('demo data stays within this month and last, never in the future', () => {
    const { rows, limits } = buildDemo('2026-10-15');
    assert.ok(rows.length > 30);
    assert.ok(rows.every((r) => r.date <= '2026-10-15' && (r.date.startsWith('2026-10') || r.date.startsWith('2026-09'))));
    assert.ok(rows.every((r) => validateDraft(r, { today: '2026-10-15' }).canSave), 'every demo row passes validation');
    assert.ok(limits.every((l) => l.month === '2026-10'));
    assert.equal(new Set(rows.map((r) => r.draftId)).size, rows.length);
});

test('demo data handles January (previous month is last December)', () => {
    const { rows } = buildDemo('2027-01-03');
    assert.ok(rows.some((r) => r.date.startsWith('2026-12')));
});

test('insights flag overspending, budgets and savings', () => {
    const out = buildInsights({
        month: '2026-10',
        today: '2026-10-15',
        currency: 'INR',
        totals: { INR: { spent: 20000, received: 50000 } },
        prevTotals: { INR: { spent: 30000, received: 50000 } },
        budgets: [
            { category: 'Shopping', currency: 'INR', spent: 6000, limit: 5000 },
            { category: 'Food & Dining', currency: 'INR', spent: 4500, limit: 5000 },
        ],
        daily: [{ date: '2026-10-02', spent: 20000 }],
        prevDaily: [{ date: '2026-09-02', spent: 10000 }, { date: '2026-09-20', spent: 20000 }],
    });
    const text = out.map((i) => i.text).join(' | ');
    assert.match(text, /100% more than at this point last month/);
    assert.match(text, /Over your Shopping budget by ₹1,000/);
    assert.match(text, /Food & Dining is at 90% of its budget/);
    assert.match(text, /kept 60%/);
    assert.match(text, /end of the month/);
});

test('insights are empty for an empty month', () => {
    assert.deepEqual(buildInsights({ month: '2026-10', today: '2026-10-15', currency: 'INR', totals: {}, prevTotals: {}, budgets: [], daily: [], prevDaily: [] }), []);
});

test('AI model and effort choices are limited to the allowlist', async () => {
    const { resolveAi } = await import('../lib/extract.js');
    assert.deepEqual(resolveAi({}, { model: 'claude-haiku-5-5', effort: 'high' }), { model: 'claude-haiku-5-5', effort: 'high' });
    assert.deepEqual(resolveAi({}, { model: 'gpt-4', effort: 'ultra' }), { model: 'claude-opus-5-5', effort: 'low' });
    assert.deepEqual(resolveAi({ ANTHROPIC_MODEL: 'claude-fable-5-1' }), { model: 'claude-fable-5-1', effort: 'low' });
});
