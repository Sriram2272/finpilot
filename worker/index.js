import { Hono } from 'hono';
import { extract, extractReceipt, askLedger, engineName, modelName, aiMeta, AiUnavailableError, BadInputError, ExtractionError } from '../lib/extract.js';
import { validateDraft, toRecord, CATEGORIES, PAYMENT_METHODS, CURRENCIES, LARGE_AMOUNT, parseIsoDate } from '../lib/schema.js';
import { buildDemo, prevMonth } from '../lib/demo.js';
import { buildInsights } from '../lib/insights.js';
import * as store from './store.js';

const MAX_NOTE = 600;
const MONTH_RE = /^\d{4}-\d{2}$/;

const app = new Hono();

const fail = (c, status, code, message, extra = {}) => c.json({ error: { code, message, ...extra } }, status);

// Use the client's local date (so "yesterday" means their yesterday), but only if it is sane.
function resolveToday(value) {
    const server = new Date().toISOString().slice(0, 10);
    if (!parseIsoDate(value)) return server;
    const diff = Math.abs(new Date(value) - new Date(server)) / 86_400_000;
    return diff <= 1 ? value : server;
}

const currentMonth = (c) => resolveToday(c.req.header('X-Today')).slice(0, 7);
const monthParam = (c) => (MONTH_RE.test(c.req.query('month') || '') ? c.req.query('month') : currentMonth(c));

app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
});

// Every ledger request carries an anonymous per-browser ledger id.
async function requireLedger(c, next) {
    const id = c.req.header('X-Ledger-Id');
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return fail(c, 400, 'NO_LEDGER', 'Missing or malformed ledger id.');
    c.set('ledgerId', id.toLowerCase());
    await next();
}

async function requireDb(c, next) {
    if (!c.env?.DB) return fail(c, 503, 'DB_DOWN', 'The database is not configured on this server.');
    await next();
}

// Small per-isolate rate limiter for the AI endpoint.
const hits = new Map();
async function rateLimit(c, next) {
    const key = c.req.header('CF-Connecting-IP') || 'local';
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (recent.length >= 20) return fail(c, 429, 'RATE_LIMITED', 'Too many requests — please wait a minute.');
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    await next();
}

async function readJson(c) {
    try {
        return (await c.req.json()) || {};
    } catch {
        return null;
    }
}

app.get('/api/health', async (c) => {
    let db = 'disconnected';
    if (c.env?.DB) {
        try {
            await store.ping(c.env.DB);
            db = 'connected';
        } catch (err) {
            console.error('DB ping failed:', err.message);
        }
    }
    const engine = engineName(c.env);
    return c.json({ ok: true, db, dbEngine: 'cloudflare-d1', engine, model: engine === 'claude' ? modelName(c.env) : null });
});

app.get('/api/meta', (c) => c.json({ categories: CATEGORIES, paymentMethods: PAYMENT_METHODS, currencies: CURRENCIES, largeAmount: LARGE_AMOUNT, ai: aiMeta(c.env) }));

// Step 1: note -> AI extraction -> schema validation. Nothing is saved here.
app.post('/api/extract', rateLimit, async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, 'BAD_JSON', 'Request body is not valid JSON.');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) return fail(c, 400, 'EMPTY_NOTE', 'Please type or say something first.');
    if (note.length > MAX_NOTE) return fail(c, 400, 'NOTE_TOO_LONG', `Please keep it under ${MAX_NOTE} characters.`);

    const today = resolveToday(body.today);
    const result = await extract(note, today, c.env, body.ai);
    if (!result.isFinancial) {
        return fail(c, 422, 'NOT_A_TRANSACTION', "That doesn't look like money spent or received. Try something like “Paid 250 for lunch at Subway today”.", { engine: result.engine });
    }
    return c.json({ ...result, today, ...validateDraft(result.draft, { today }) });
});

// Same as /extract, but from a photo of a receipt or bill (Claude vision).
const MAX_IMAGE = 6_000_000; // characters of base64, about 4.5 MB
app.post('/api/extract-receipt', rateLimit, async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, 'BAD_JSON', 'Request body is not valid JSON.');
    if (typeof body.image !== 'string' || !body.image) return fail(c, 400, 'NO_IMAGE', 'Please choose a photo first.');
    if (body.image.length > MAX_IMAGE) return fail(c, 413, 'TOO_LARGE', 'That photo is too large. Try a smaller one.');
    const today = resolveToday(body.today);
    try {
        const result = await extractReceipt(body.image, today, c.env, body.ai);
        if (!result.isFinancial) return fail(c, 422, 'NOT_A_TRANSACTION', "That doesn't look like a receipt or bill. Try a clearer photo.", { engine: 'claude' });
        return c.json({ ...result, today, ...validateDraft(result.draft, { today }) });
    } catch (err) {
        return aiError(c, err);
    }
});

function aiError(c, err) {
    if (err instanceof AiUnavailableError) return fail(c, 503, 'AI_UNAVAILABLE', err.message);
    if (err instanceof BadInputError) return fail(c, 400, 'BAD_INPUT', err.message);
    if (err instanceof ExtractionError) return fail(c, 502, 'AI_FAILED', err.message);
    console.error('AI call failed:', err.message);
    return fail(c, 502, 'AI_FAILED', 'The AI service could not be reached. Please try again, or pick a different model.');
}

// Re-validates a user-confirmed draft. Returns the record or an error response.
function checkDraft(c, body) {
    const { draft, confirmLarge } = body;
    if (!draft || typeof draft !== 'object') return { error: fail(c, 400, 'NO_DRAFT', 'Nothing to save.') };
    // Never trust the browser: validate again with the same rules.
    const validation = validateDraft({ ...draft, currencyAssumed: false }, { today: resolveToday(body.today) });
    if (!validation.canSave) {
        return { error: fail(c, 422, 'VALIDATION_FAILED', 'Some required fields are missing or invalid.', { fields: validation.fields, blocking: validation.blocking }) };
    }
    if (validation.isLarge && confirmLarge !== true) {
        return { error: fail(c, 409, 'CONFIRM_LARGE', `Amounts of ${LARGE_AMOUNT.toLocaleString('en-IN')} or more need an explicit confirmation.`) };
    }
    return { record: toRecord(validation.fields) };
}

const cleanEdited = (list) => (Array.isArray(list) ? list.filter((f) => typeof f === 'string').slice(0, 10) : []);

const ledger = new Hono();
ledger.use('*', requireLedger, requireDb);

// Step 2: user-confirmed draft -> re-validate on the server -> save. Totals are computed from the ledger.
ledger.post('/transactions', async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, 'BAD_JSON', 'Request body is not valid JSON.');
    const { draftId, engine, note, editedFields } = body;
    if (typeof draftId !== 'string' || draftId.length < 8 || draftId.length > 64) return fail(c, 400, 'NO_DRAFT_ID', 'Missing draft id.');
    const { record, error } = checkDraft(c, body);
    if (error) return error;

    const db = c.env.DB;
    let tx;
    try {
        tx = await store.createTransaction(db, c.get('ledgerId'), {
            ...record,
            draftId,
            source: {
                engine: ['claude', 'offline', 'manual'].includes(engine) ? engine : 'manual',
                note: typeof note === 'string' ? note.slice(0, MAX_NOTE) : null,
                editedFields: cleanEdited(editedFields),
            },
        });
    } catch (err) {
        if (/UNIQUE constraint failed/i.test(err.message)) return fail(c, 409, 'DUPLICATE', 'This entry was already saved.');
        throw err;
    }
    const budget = record.type === 'expense' ? await store.getBudget(db, c.get('ledgerId'), record.date.slice(0, 7), record.category, record.currency) : null;
    return c.json({ transaction: tx, budget }, 201);
});

ledger.get('/transactions', async (c) => {
    const month = MONTH_RE.test(c.req.query('month') || '') ? c.req.query('month') : null;
    const category = CATEGORIES.includes(c.req.query('category')) ? c.req.query('category') : null;
    const type = ['expense', 'income'].includes(c.req.query('type')) ? c.req.query('type') : null;
    const q = (c.req.query('q') || '').trim().slice(0, 60) || null;
    return c.json(await store.listTransactions(c.env.DB, c.get('ledgerId'), { month, category, type, q }));
});

ledger.patch('/transactions/:id', async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, 'BAD_JSON', 'Request body is not valid JSON.');
    const { record, error } = checkDraft(c, body);
    if (error) return error;
    const tx = await store.updateTransaction(c.env.DB, c.get('ledgerId'), c.req.param('id'), record, cleanEdited(body.editedFields));
    if (!tx) return fail(c, 404, 'NOT_FOUND', 'Transaction not found.');
    return c.json({ transaction: tx });
});

ledger.delete('/transactions/:id', async (c) => {
    const tx = await store.deleteTransaction(c.env.DB, c.get('ledgerId'), c.req.param('id'));
    if (!tx) return fail(c, 404, 'NOT_FOUND', 'Transaction not found.');
    return c.json({ deleted: tx.id });
});

ledger.get('/budgets', async (c) => {
    const month = monthParam(c);
    const rows = await store.getBudgets(c.env.DB, c.get('ledgerId'), month);
    return c.json({ month, budgets: rows });
});

// Set (or clear) a monthly limit for one category.
ledger.put('/budgets', async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, 'BAD_JSON', 'Request body is not valid JSON.');
    const { month, category, currency = 'INR' } = body;
    const limit = body.limit === null || body.limit === '' || body.limit === undefined ? null : Number(body.limit);
    if (!MONTH_RE.test(month || '')) return fail(c, 400, 'BAD_MONTH', 'Month must look like 2026-10.');
    if (!CATEGORIES.includes(category)) return fail(c, 400, 'BAD_CATEGORY', 'Unknown category.');
    if (!CURRENCIES.includes(currency)) return fail(c, 400, 'BAD_CURRENCY', 'Unknown currency.');
    if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 10_000_000)) return fail(c, 400, 'BAD_LIMIT', 'Limit must be a positive number.');
    const budget = await store.setLimit(c.env.DB, c.get('ledgerId'), { month, category, currency, limit });
    return c.json(budget || { month, category, currency, spent: 0, count: 0, limit: null });
});

// Everything the dashboard needs for one month in a single round trip.
ledger.get('/summary', async (c) => {
    const db = c.env.DB;
    const id = c.get('ledgerId');
    const month = monthParam(c);
    const prev = prevMonth(month);
    const today = resolveToday(c.req.header('X-Today'));
    const [totals, prevTotals, budgets] = await Promise.all([store.monthTotals(db, id, month), store.monthTotals(db, id, prev), store.getBudgets(db, id, month)]);
    // Charts use the currency with the most activity this month.
    const currency = Object.entries(totals).sort((a, b) => b[1].count - a[1].count)[0]?.[0] || 'INR';
    const [daily, prevDaily] = await Promise.all([store.dailySpend(db, id, month, currency), store.dailySpend(db, id, prev, currency)]);
    const insights = buildInsights({ month, today, currency, totals, prevTotals, budgets, daily, prevDaily });
    return c.json({ month, prevMonth: prev, currency, totals, prevTotals, budgets, daily, insights });
});

const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

ledger.get('/export.csv', async (c) => {
    const month = MONTH_RE.test(c.req.query('month') || '') ? c.req.query('month') : null;
    const rows = await store.listTransactions(c.env.DB, c.get('ledgerId'), { month, limit: 5000 });
    const header = ['date', 'type', 'amount', 'currency', 'category', 'merchant', 'payment_method', 'description'];
    const lines = [header.join(',')].concat(rows.map((t) => [t.date, t.type, t.amount, t.currency, t.category, t.merchant, t.paymentMethod, t.description].map(csvCell).join(',')));
    return new Response(`${lines.join('\n')}\n`, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="finpilot-${month || 'all'}.csv"` },
    });
});

// Demo mode: fill the ledger with a realistic month so every feature can be tried in one click.
ledger.post('/demo', async (c) => {
    const body = (await readJson(c)) || {};
    const today = resolveToday(body.today);
    const count = await store.seedDemo(c.env.DB, c.get('ledgerId'), buildDemo(today));
    return c.json({ seeded: count }, 201);
});

ledger.delete('/demo', async (c) => c.json({ removed: await store.clearDemo(c.env.DB, c.get('ledgerId')) }));

// Ask FinPilot: a question about this month's ledger, answered by Claude from the user's own data.
ledger.post('/ask', rateLimit, async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, 'BAD_JSON', 'Request body is not valid JSON.');
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return fail(c, 400, 'EMPTY_QUESTION', 'Type a question first.');
    if (question.length > 300) return fail(c, 400, 'QUESTION_TOO_LONG', 'Please keep questions under 300 characters.');
    const db = c.env.DB;
    const id = c.get('ledgerId');
    const month = MONTH_RE.test(body.month || '') ? body.month : currentMonth(c);
    const prev = prevMonth(month);
    const slim = (t) => ({ date: t.date, type: t.type, amount: t.amount, currency: t.currency, category: t.category, merchant: t.merchant, description: t.description });
    const [txs, prevTxs, totals, prevTotals, budgets] = await Promise.all([
        store.listTransactions(db, id, { month, limit: 300 }),
        store.listTransactions(db, id, { month: prev, limit: 300 }),
        store.monthTotals(db, id, month),
        store.monthTotals(db, id, prev),
        store.getBudgets(db, id, month),
    ]);
    const context = {
        today: resolveToday(c.req.header('X-Today')),
        month,
        totals,
        budgets: budgets.map(({ category, currency, spent, count, limit }) => ({ category, currency, spent, count, limit })),
        transactions: txs.map(slim),
        previousMonth: { month: prev, totals: prevTotals, transactions: prevTxs.map(slim) },
    };
    try {
        return c.json(await askLedger(question, context, c.env, body.ai));
    } catch (err) {
        return aiError(c, err);
    }
});

ledger.delete('/ledger', async (c) => c.json({ removed: await store.clearLedger(c.env.DB, c.get('ledgerId')) }));

app.route('/api', ledger);

// Unknown API routes get JSON, not the React page.
app.all('/api/*', (c) => fail(c, 404, 'NOT_FOUND', 'No such endpoint.'));

// One place for unexpected errors, so the client always gets a readable message.
app.onError((err, c) => {
    console.error(err);
    return fail(c, 500, 'SERVER_ERROR', 'Something went wrong on our side. Please try again.');
});

// Anything that isn't /api is the React app (served by Workers Static Assets).
app.all('*', (c) => (c.env?.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404)));

export default app;
