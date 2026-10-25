const mongoose = require('mongoose');
const { CATEGORIES, PAYMENT_METHODS, TYPES, CURRENCIES } = require('../lib/schema');

const TransactionSchema = new mongoose.Schema(
    {
        // Each browser gets its own private ledger id (no accounts needed).
        ledgerId: { type: String, required: true, index: true },
        // Client-generated id for the draft, so a double-click can't save twice.
        draftId: { type: String, required: true },
        type: { type: String, enum: TYPES, required: true },
        amount: { type: Number, required: true, min: 0.01 },
        currency: { type: String, enum: CURRENCIES, required: true },
        category: { type: String, enum: CATEGORIES, required: true },
        date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        merchant: { type: String, default: null },
        paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
        description: { type: String, default: null },
        source: {
            engine: { type: String, enum: ['claude', 'offline', 'manual'] },
            note: String, // redacted copy of what the user said
            editedFields: [String], // fields the user changed during review
        },
    },
    { timestamps: true }
);

TransactionSchema.index({ ledgerId: 1, draftId: 1 }, { unique: true });
TransactionSchema.index({ ledgerId: 1, date: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
