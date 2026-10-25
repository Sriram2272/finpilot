const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Transaction = require('../models/transaction');
const Budget = require('../models/budget');
const { extract, engineName, MODEL } = require('../lib/extract');
const { validateDraft, toRecord, CATEGORIES, PAYMENT_METHODS, CURRENCIES, LARGE_AMOUNT, parseIsoDate } = require('../lib/schema');

const MAX_NOTE = 600;

const fail = (res, status, code, message, extra = {}) => res.status(status).json({ error: { code, message, ...extra } });

// Use the client's local date (so "yesterday" means their yesterday), but only if it is sane.
function resolveToday(value) {
    const server = new Date().toISOString().slice(0, 10);
    if (!parseIsoDate(value)) return server;
    const diff = Math.abs(new Date(value) - new Date(server)) / 86_400_000;
    return diff <= 1 ? value : server;
}

// Every request carries an anonymous per-browser ledger id.
function requireLedger(req, res, next) {
    const id = req.get('X-Ledger-Id');
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return fail(res, 400, 'NO_LEDGER', 'Missing or malformed ledger id.');
    req.ledgerId = id.toLowerCase();
    next();
}

function requireDb(req, res, next) {
    if (mongoose.connection.readyState !== 1) return fail(res, 503, 'DB_DOWN', 'The database is not reachable right now. Please try again shortly.');
    next();
}

// Tiny in-memory rate limiter for the AI endpoint.
const hits = new Map();
function rateLimit(req, res, next) {
    const key = req.ip;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (recent.length >= 20) return fail(res, 429, 'RATE_LIMITED', 'Too many requests — please wait a minute.');
    recent.push(now);
    hits.set(key, recent);
    next();
}

router.get('/health', (req, res) => {
    res.json({
        ok: true,
        db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        engine: engineName(),
        model: engineName() === 'claude' ? MODEL : null,
    });
});

router.get('/meta', (req, res) => {
    res.json({ categories: CATEGORIES, paymentMethods: PAYMENT_METHODS, currencies: CURRENCIES, largeAmount: LARGE_AMOUNT });
});

// Step 1: note -> AI extraction -> schema validation. Nothing is saved here.
router.post('/extract', rateLimit, async (req, res, next) => {
    try {
        const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
        if (!note) return fail(res, 400, 'EMPTY_NOTE', 'Please type or say something first.');
        if (note.length > MAX_NOTE) return fail(res, 400, 'NOTE_TOO_LONG', `Please keep it under ${MAX_NOTE} characters.`);

        const today = resolveToday(req.body.today);
        const result = await extract(note, today);

        if (!result.isFinancial) {
            return fail(res, 422, 'NOT_A_TRANSACTION', "That doesn't look like money spent or received. Try something like “Paid 250 for lunch at Subway today”.", {
                engine: result.engine,
            });
        }

        const validation = validateDraft(result.draft, { today });
        res.json({ ...result, today, ...validation });
    } catch (err) {
        next(err);
    }
});

// Step 2: user-confirmed draft -> re-validate on the server -> create + update budget.
router.post('/transactions', requireLedger, requireDb, async (req, res, next) => {
    try {
        const { draft, draftId, confirmLarge, engine, note, editedFields } = req.body || {};
        if (!draft || typeof draft !== 'object') return fail(res, 400, 'NO_DRAFT', 'Nothing to save.');
        if (typeof draftId !== 'string' || draftId.length < 8 || draftId.length > 64) return fail(res, 400, 'NO_DRAFT_ID', 'Missing draft id.');

        // Never trust the browser: validate again with the same rules.
        const today = resolveToday(req.body.today);
        const validation = validateDraft({ ...draft, currencyAssumed: false }, { today });
        if (!validation.canSave) {
            return fail(res, 422, 'VALIDATION_FAILED', 'Some required fields are missing or invalid.', { fields: validation.fields, blocking: validation.blocking });
        }
        if (validation.isLarge && confirmLarge !== true) {
            return fail(res, 409, 'CONFIRM_LARGE', `Amounts of ${LARGE_AMOUNT.toLocaleString('en-IN')} or more need an explicit confirmation.`);
        }

        const record = toRecord(validation.fields);
        let tx;
        try {
            tx = await Transaction.create({
                ...record,
                ledgerId: req.ledgerId,
                draftId,
                source: {
                    engine: ['claude', 'offline', 'manual'].includes(engine) ? engine : 'manual',
                    note: typeof note === 'string' ? note.slice(0, MAX_NOTE) : undefined,
                    editedFields: Array.isArray(editedFields) ? editedFields.filter((f) => typeof f === 'string').slice(0, 10) : [],
                },
            });
        } catch (err) {
            if (err.code === 11000) return fail(res, 409, 'DUPLICATE', 'This entry was already saved.');
            throw err;
        }

        // Update the running monthly total for this category (create the row if needed).
        let budget = null;
        if (record.type === 'expense') {
            try {
                budget = await Budget.findOneAndUpdate(
                    { ledgerId: req.ledgerId, month: record.date.slice(0, 7), category: record.category, currency: record.currency },
                    { $inc: { spent: record.amount, count: 1 } },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
            } catch (err) {
                await Transaction.deleteOne({ _id: tx._id }); // keep ledger and totals consistent
                throw err;
            }
        }

        const { ledgerId, __v, ...saved } = tx.toObject();
        res.status(201).json({ transaction: saved, budget });
    } catch (err) {
        next(err);
    }
});

router.get('/transactions', requireLedger, requireDb, async (req, res, next) => {
    try {
        const filter = { ledgerId: req.ledgerId };
        if (/^\d{4}-\d{2}$/.test(req.query.month || '')) filter.date = { $regex: `^${req.query.month}` };
        const items = await Transaction.find(filter, '-ledgerId -__v').sort({ date: -1, createdAt: -1 }).limit(100);
        res.json(items);
    } catch (err) {
        next(err);
    }
});

router.delete('/transactions/:id', requireLedger, requireDb, async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_ID', 'Invalid transaction id.');
        const tx = await Transaction.findOneAndDelete({ _id: req.params.id, ledgerId: req.ledgerId });
        if (!tx) return fail(res, 404, 'NOT_FOUND', 'Transaction not found.');
        if (tx.type === 'expense') {
            await Budget.updateOne(
                { ledgerId: req.ledgerId, month: tx.date.slice(0, 7), category: tx.category, currency: tx.currency },
                { $inc: { spent: -tx.amount, count: -1 } }
            );
        }
        res.json({ deleted: tx._id });
    } catch (err) {
        next(err);
    }
});

router.get('/budgets', requireLedger, requireDb, async (req, res, next) => {
    try {
        const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
        const rows = await Budget.find({ ledgerId: req.ledgerId, month }, '-ledgerId -__v').sort({ spent: -1 });
        res.json({ month, budgets: rows.filter((b) => b.count > 0 || b.limit != null) });
    } catch (err) {
        next(err);
    }
});

// Set (or clear) a monthly limit for one category.
router.put('/budgets', requireLedger, requireDb, async (req, res, next) => {
    try {
        const { month, category, currency = 'INR' } = req.body || {};
        const limit = req.body.limit === null || req.body.limit === '' ? null : Number(req.body.limit);
        if (!/^\d{4}-\d{2}$/.test(month || '')) return fail(res, 400, 'BAD_MONTH', 'Month must look like 2026-10.');
        if (!CATEGORIES.includes(category)) return fail(res, 400, 'BAD_CATEGORY', 'Unknown category.');
        if (!CURRENCIES.includes(currency)) return fail(res, 400, 'BAD_CURRENCY', 'Unknown currency.');
        if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 10_000_000)) return fail(res, 400, 'BAD_LIMIT', 'Limit must be a positive number.');

        const budget = await Budget.findOneAndUpdate(
            { ledgerId: req.ledgerId, month, category, currency },
            { $set: { limit } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.json(budget);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
