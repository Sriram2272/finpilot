const test = require('node:test');
const assert = require('node:assert');
const { validateDraft, AiExtractionSchema } = require('../lib/schema');
const { redact, extractOffline } = require('../lib/extract');

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
