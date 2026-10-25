const mongoose = require('mongoose');
const { CATEGORIES, CURRENCIES } = require('../lib/schema');

// One row per ledger + month + category + currency. "spent" is kept up to date
// every time a transaction is saved or deleted.
const BudgetSchema = new mongoose.Schema(
    {
        ledgerId: { type: String, required: true },
        month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
        category: { type: String, enum: CATEGORIES, required: true },
        currency: { type: String, enum: CURRENCIES, required: true },
        spent: { type: Number, default: 0 },
        count: { type: Number, default: 0 },
        limit: { type: Number, default: null, min: 0 },
    },
    { timestamps: true }
);

BudgetSchema.index({ ledgerId: 1, month: 1, category: 1, currency: 1 }, { unique: true });

module.exports = mongoose.model('Budget', BudgetSchema);
