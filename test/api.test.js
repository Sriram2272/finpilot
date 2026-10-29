// End-to-end tests of the Worker's HTTP API against a real SQLite database.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert';
import app from '../worker/index.js';
import { createD1 } from './helpers/d1.js';

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const LEDGER = '11111111-2222-3333-4444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let env;
beforeEach(() => {
    env = { DB: createD1() };
});

async function call(method, path, body, { ledger = LEDGER, raw = false } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Today': today };
    if (ledger) headers['X-Ledger-Id'] = ledger;
    const res = await app.request(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }, env);
    return { status: res.status, data: raw ? await res.text() : await res.json(), headers: res.headers };
}

const draft = (over = {}) => ({ type: 'expense', amount: 450, currency: 'INR', category: 'Food & Dining', date: today, merchant: 'Subway', paymentMethod: 'card', description: 'Lunch', ...over });
let n = 0;
const save = (d = draft(), extra = {}) => call('POST', '/transactions', { draft: d, draftId: `draft-${++n}-xxxxxxxx`, today, engine: 'offline', ...extra });

test('health reports the database as connected', async () => {
    const { status, data } = await call('GET', '/health');
    assert.equal(status, 200);
    assert.equal(data.db, 'connected');
    assert.equal(data.engine, 'offline');
});

test('health reports a missing database instead of crashing', async () => {
    env = {};
    const { data } = await call('GET', '/health');
    assert.equal(data.db, 'disconnected');
    assert.equal((await call('GET', '/transactions')).status, 503);
});

test('extract → save → list → budget total, the full happy path', async () => {
    const ex = await call('POST', '/extract', { note: 'Spent ₹450 on lunch at Barbeque Nation yesterday, paid by card', today });
    assert.equal(ex.status, 200);
    assert.equal(ex.data.canSave, true);
    assert.equal(ex.data.fields.amount.value, 450);

    const draftValues = Object.fromEntries(Object.entries(ex.data.fields).map(([k, f]) => [k, f.value]));
    const saved = await save(draftValues);
    assert.equal(saved.status, 201);
    assert.equal(saved.data.transaction.amount, 450);
    assert.equal(saved.data.budget.spent, 450);
    assert.equal(saved.data.budget.count, 1);

    const list = await call('GET', '/transactions');
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].merchant, 'Barbeque Nation');
});

test('extract rejects empty, too long and non-financial notes', async () => {
    assert.equal((await call('POST', '/extract', { note: '  ' })).data.error.code, 'EMPTY_NOTE');
    assert.equal((await call('POST', '/extract', { note: 'x'.repeat(601) })).data.error.code, 'NOTE_TOO_LONG');
    assert.equal((await call('POST', '/extract', { note: 'what is the weather tomorrow?' })).status, 422);
});

test('extract redacts card numbers before anything else sees them', async () => {
    const { data } = await call('POST', '/extract', { note: 'paid 500 for dinner today with card 4111 1111 1111 1111', today });
    assert.ok(!data.redactedNote.includes('4111'));
    assert.ok(data.notices.some((t) => /card number/.test(t)));
});

test('the server re-validates and never trusts the browser', async () => {
    const bad = await save(draft({ amount: -5, date: null }));
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.data.error.blocking.sort(), ['amount', 'date']);
    assert.equal((await save(draft({ category: 'Crypto' }))).status, 422);
});

test('large amounts need explicit confirmation', async () => {
    assert.equal((await save(draft({ amount: 50000 }))).status, 409);
    assert.equal((await save(draft({ amount: 50000 }), { confirmLarge: true })).status, 201);
});

test('the same draft cannot be saved twice (double-click safe)', async () => {
    const body = { draft: draft(), draftId: 'same-draft-123', today };
    assert.equal((await call('POST', '/transactions', body)).status, 201);
    const dup = await call('POST', '/transactions', body);
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error.code, 'DUPLICATE');
});

test('ledgers are private to each browser id', async () => {
    await save();
    assert.equal((await call('GET', '/transactions', null, { ledger: OTHER })).data.length, 0);
    const id = (await call('GET', '/transactions')).data[0].id;
    assert.equal((await call('DELETE', `/transactions/${id}`, null, { ledger: OTHER })).status, 404);
    assert.equal((await call('GET', '/transactions', null, { ledger: null })).status, 400);
});

test('edit updates the entry and the category totals follow', async () => {
    const { data } = await save();
    const id = data.transaction.id;
    const edited = await call('PATCH', `/transactions/${id}`, { draft: draft({ amount: 600, category: 'Groceries' }), editedFields: ['amount', 'category'], today });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.transaction.amount, 600);
    assert.deepEqual(edited.data.transaction.source.editedFields, ['amount', 'category']);
    const { data: b } = await call('GET', `/budgets?month=${month}`);
    assert.deepEqual(b.budgets.map((r) => [r.category, r.spent]), [['Groceries', 600]]);
});

test('delete removes the entry and its total', async () => {
    const { data } = await save();
    assert.equal((await call('DELETE', `/transactions/${data.transaction.id}`)).status, 200);
    assert.equal((await call('GET', `/budgets?month=${month}`)).data.budgets.length, 0);
});

test('budget limits can be set, shown and cleared', async () => {
    await save();
    const set = await call('PUT', '/budgets', { month, category: 'Food & Dining', currency: 'INR', limit: 3000 });
    assert.equal(set.data.limit, 3000);
    assert.equal(set.data.spent, 450);
    assert.equal((await call('PUT', '/budgets', { month, category: 'Food & Dining', limit: -1 })).status, 400);
    const cleared = await call('PUT', '/budgets', { month, category: 'Food & Dining', currency: 'INR', limit: null });
    assert.equal(cleared.data.limit, null);
});

test('search and filters narrow the ledger', async () => {
    await save(draft({ merchant: 'Starbucks', description: 'Coffee' }));
    await save(draft({ merchant: 'Uber', description: 'Ride', category: 'Transport' }));
    await save(draft({ type: 'income', category: 'Salary & Income', merchant: 'Acme', description: 'Salary', amount: 5000 }));
    assert.equal((await call('GET', '/transactions?q=star')).data.length, 1);
    assert.equal((await call('GET', '/transactions?category=Transport')).data.length, 1);
    assert.equal((await call('GET', '/transactions?type=income')).data.length, 1);
    assert.equal((await call('GET', '/transactions?q=%25')).data.length, 0, 'LIKE wildcards are escaped');
});

test('demo mode seeds a realistic ledger, powers the dashboard, and clears cleanly', async () => {
    await save(); // a real entry that must survive clearing the demo
    const seeded = await call('POST', '/demo', { today });
    assert.equal(seeded.status, 201);
    assert.ok(seeded.data.seeded > 5);

    const summary = await call('GET', `/summary?month=${month}`);
    assert.equal(summary.status, 200);
    assert.ok(summary.data.totals.INR.spent > 0);
    assert.ok(summary.data.budgets.length > 0);
    assert.ok(summary.data.daily.length > 0);
    assert.ok(summary.data.insights.length > 0);

    // Seeding again replaces the demo rows instead of duplicating them.
    await call('POST', '/demo', { today });
    const all = await call('GET', '/transactions');
    assert.equal(all.data.filter((t) => t.isDemo).length, seeded.data.seeded);

    const cleared = await call('DELETE', '/demo');
    assert.equal(cleared.data.removed, seeded.data.seeded);
    const left = (await call('GET', '/transactions')).data;
    assert.equal(left.length, 1);
    assert.equal(left[0].isDemo, false);
});

test('CSV export is downloadable and safe to open in a spreadsheet', async () => {
    await save(draft({ merchant: '=HYPERLINK("x")', description: 'Lunch, with team' }));
    const res = await call('GET', `/export.csv?month=${month}`, null, { raw: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /text\/csv/);
    const [header, row] = res.data.trim().split('\n');
    assert.equal(header, 'date,type,amount,currency,category,merchant,payment_method,description');
    assert.ok(row.includes('"=HYPERLINK(""x"")"'));
    assert.ok(row.includes('"Lunch, with team"'));
});

test('reset wipes only this ledger', async () => {
    await save();
    await call('POST', '/transactions', { draft: draft(), draftId: 'other-ledger-1', today }, { ledger: OTHER });
    await call('DELETE', '/ledger');
    assert.equal((await call('GET', '/transactions')).data.length, 0);
    assert.equal((await call('GET', '/transactions', null, { ledger: OTHER })).data.length, 1);
});

test('bad JSON and unknown endpoints get readable JSON errors', async () => {
    const res = await app.request('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' }, env);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'BAD_JSON');
    const missing = await app.request('/api/nope', {}, env);
    assert.ok([400, 404].includes(missing.status));
});
