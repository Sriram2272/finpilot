import { z } from 'zod';

const CATEGORIES = [
    'Food & Dining',
    'Groceries',
    'Transport',
    'Shopping',
    'Bills & Utilities',
    'Rent & Housing',
    'Health',
    'Entertainment',
    'Travel',
    'Education',
    'Personal Care',
    'Gifts & Donations',
    'Salary & Income',
    'Other',
];

const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'wallet'];
const TYPES = ['expense', 'income'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'CAD', 'AUD', 'JPY'];

const DEFAULT_CURRENCY = 'INR';
const MAX_AMOUNT = 10_000_000;
// Anything at or above this needs an explicit "yes, I'm sure" before it is saved.
const LARGE_AMOUNT = 10_000;

// The schema the model must fill in. Every field is nullable so the model can say
// "not mentioned" instead of inventing a value. Business rules (positive amount,
// real dates, ...) are checked afterwards in validateDraft().
const AiExtractionSchema = z.object({
    is_financial_transaction: z
        .boolean()
        .describe('false if the text does not describe money being spent or received'),
    type: z.enum(TYPES).nullable(),
    amount: z.number().nullable().describe('Numeric amount only, no currency symbol'),
    currency: z.enum(CURRENCIES).nullable().describe('Only if a currency is stated or clearly implied by a symbol/word'),
    merchant: z.string().nullable().describe('Shop, person or company paid / received from'),
    category: z.enum(CATEGORIES).nullable(),
    date: z.string().nullable().describe('YYYY-MM-DD, resolved against the given today date'),
    payment_method: z.enum(PAYMENT_METHODS).nullable(),
    description: z.string().nullable().describe('Short plain-English label, max 8 words'),
    ambiguities: z.array(z.string()).describe('Anything unclear the user should double-check'),
});

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value) {
    if (typeof value !== 'string' || !isoDate.test(value)) return null;
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

function addDays(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

// Turns a raw draft (from the AI, the offline parser, or the user's edits) into a
// per-field report. Status is one of: ok | missing | invalid | assumed.
function validateDraft(raw, { today }) {
    const fields = {};
    const set = (name, value, status, message) => (fields[name] = { value, status, message: message || null });

    // type
    if (TYPES.includes(raw.type)) set('type', raw.type, 'ok');
    else if (raw.type == null || raw.type === '') set('type', null, 'missing', 'Is this money spent or received?');
    else set('type', null, 'invalid', 'Type must be expense or income.');

    // amount
    const amount = typeof raw.amount === 'string' && raw.amount.trim() !== '' ? Number(raw.amount) : raw.amount;
    if (amount == null || amount === '') set('amount', null, 'missing', 'No amount was mentioned.');
    else if (typeof amount !== 'number' || !Number.isFinite(amount)) set('amount', null, 'invalid', 'Amount must be a number.');
    else if (amount <= 0) set('amount', amount, 'invalid', 'Amount must be greater than zero.');
    else if (amount > MAX_AMOUNT) set('amount', amount, 'invalid', 'That amount looks too large to be right.');
    else set('amount', Math.round(amount * 100) / 100, 'ok');

    // currency — defaulting is allowed, but it is flagged so the user sees it.
    if (CURRENCIES.includes(raw.currency)) set('currency', raw.currency, raw.currencyAssumed ? 'assumed' : 'ok', raw.currencyAssumed ? `Not mentioned — assumed ${raw.currency}.` : null);
    else if (raw.currency == null || raw.currency === '') set('currency', DEFAULT_CURRENCY, 'assumed', `Not mentioned — assumed ${DEFAULT_CURRENCY}.`);
    else set('currency', null, 'invalid', `Unsupported currency "${raw.currency}".`);

    // category
    if (CATEGORIES.includes(raw.category)) set('category', raw.category, 'ok');
    else if (raw.category == null || raw.category === '') set('category', null, 'missing', 'Pick a category.');
    else set('category', null, 'invalid', 'Unknown category.');

    // date — never guessed; the user can tap "today" in the UI.
    if (raw.date == null || raw.date === '') set('date', null, 'missing', 'No date was mentioned.');
    else if (!parseIsoDate(raw.date)) set('date', null, 'invalid', 'Date must be a real calendar date.');
    else if (raw.date > addDays(today, 1)) set('date', raw.date, 'invalid', 'Date is in the future.');
    else if (raw.date < '2000-01-01') set('date', raw.date, 'invalid', 'Date is too far in the past.');
    else set('date', raw.date, 'ok');

    // optional fields
    const merchant = clean(raw.merchant);
    set('merchant', merchant, merchant ? 'ok' : 'missing', merchant ? null : 'Optional — not mentioned.');

    if (PAYMENT_METHODS.includes(raw.paymentMethod)) set('paymentMethod', raw.paymentMethod, 'ok');
    else set('paymentMethod', null, 'missing', 'Optional — not mentioned.');

    const description = clean(raw.description);
    set('description', description, description ? 'ok' : 'missing', description ? null : 'Optional.');

    const required = ['type', 'amount', 'currency', 'category', 'date'];
    const blocking = required.filter((f) => !['ok', 'assumed'].includes(fields[f].status));
    const isLarge = fields.amount.status === 'ok' && fields.amount.value >= LARGE_AMOUNT;

    return { fields, blocking, canSave: blocking.length === 0, isLarge };
}

// Shape stored in the database, built only from validated fields.
function toRecord(fields) {
    const v = (k) => fields[k].value;
    return {
        type: v('type'),
        amount: v('amount'),
        currency: v('currency'),
        category: v('category'),
        date: v('date'),
        merchant: v('merchant'),
        paymentMethod: v('paymentMethod'),
        description: v('description'),
    };
}

export {
    CATEGORIES,
    PAYMENT_METHODS,
    TYPES,
    CURRENCIES,
    DEFAULT_CURRENCY,
    LARGE_AMOUNT,
    MAX_AMOUNT,
    AiExtractionSchema,
    validateDraft,
    toRecord,
    addDays,
    parseIsoDate,
};
