// All D1 access lives here. Rows are stored snake_case and returned camelCase.

const COLUMNS = 'id, type, amount, currency, category, date, merchant, payment_method, description, source_engine, source_note, edited_fields, is_demo, created_at, updated_at';

export function toApi(row) {
    if (!row) return null;
    return {
        id: row.id,
        type: row.type,
        amount: row.amount,
        currency: row.currency,
        category: row.category,
        date: row.date,
        merchant: row.merchant,
        paymentMethod: row.payment_method,
        description: row.description,
        source: { engine: row.source_engine, note: row.source_note, editedFields: JSON.parse(row.edited_fields || '[]') },
        isDemo: Boolean(row.is_demo),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

const insertSql = `INSERT INTO transactions (id, ledger_id, draft_id, type, amount, currency, category, date, merchant, payment_method, description, source_engine, source_note, edited_fields, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertStmt(db, ledgerId, r, isDemo = false) {
    return db
        .prepare(insertSql)
        .bind(
            r.id || crypto.randomUUID(),
            ledgerId,
            r.draftId,
            r.type,
            r.amount,
            r.currency,
            r.category,
            r.date,
            r.merchant ?? null,
            r.paymentMethod ?? null,
            r.description ?? null,
            r.source?.engine ?? (isDemo ? 'manual' : null),
            r.source?.note ?? null,
            JSON.stringify(r.source?.editedFields ?? []),
            isDemo ? 1 : 0
        );
}

export async function ping(db) {
    await db.prepare('SELECT 1 AS ok').first();
}

export async function createTransaction(db, ledgerId, record) {
    const id = crypto.randomUUID();
    await insertStmt(db, ledgerId, { ...record, id }).run();
    return getTransaction(db, ledgerId, id);
}

export async function getTransaction(db, ledgerId, id) {
    return toApi(await db.prepare(`SELECT ${COLUMNS} FROM transactions WHERE id = ? AND ledger_id = ?`).bind(id, ledgerId).first());
}

export async function listTransactions(db, ledgerId, { month, q, category, type, limit = 200 } = {}) {
    const where = ['ledger_id = ?'];
    const args = [ledgerId];
    if (month) {
        where.push('date LIKE ?');
        args.push(`${month}-%`);
    }
    if (category) {
        where.push('category = ?');
        args.push(category);
    }
    if (type) {
        where.push('type = ?');
        args.push(type);
    }
    if (q) {
        where.push("(merchant LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
        const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        args.push(like, like, like);
    }
    const { results } = await db
        .prepare(`SELECT ${COLUMNS} FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC, created_at DESC LIMIT ?`)
        .bind(...args, limit)
        .all();
    return results.map(toApi);
}

export async function updateTransaction(db, ledgerId, id, record, editedFields) {
    const res = await db
        .prepare(
            `UPDATE transactions SET type = ?, amount = ?, currency = ?, category = ?, date = ?, merchant = ?, payment_method = ?, description = ?,
             edited_fields = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND ledger_id = ?`
        )
        .bind(record.type, record.amount, record.currency, record.category, record.date, record.merchant, record.paymentMethod, record.description, JSON.stringify(editedFields), id, ledgerId)
        .run();
    return res.meta.changes ? getTransaction(db, ledgerId, id) : null;
}

export async function deleteTransaction(db, ledgerId, id) {
    const before = await getTransaction(db, ledgerId, id);
    if (!before) return null;
    await db.prepare('DELETE FROM transactions WHERE id = ? AND ledger_id = ?').bind(id, ledgerId).run();
    return before;
}

// Spent per category for a month, merged with any limits set for it.
export async function getBudgets(db, ledgerId, month) {
    const [spent, limits] = await db.batch([
        db
            .prepare(
                `SELECT category, currency, SUM(amount) AS spent, COUNT(*) AS count FROM transactions
                 WHERE ledger_id = ? AND type = 'expense' AND date LIKE ? GROUP BY category, currency`
            )
            .bind(ledgerId, `${month}-%`),
        db.prepare('SELECT category, currency, limit_amount FROM budget_limits WHERE ledger_id = ? AND month = ?').bind(ledgerId, month),
    ]);
    const map = new Map();
    for (const r of spent.results) map.set(`${r.category}|${r.currency}`, { month, category: r.category, currency: r.currency, spent: round(r.spent), count: r.count, limit: null });
    for (const r of limits.results) {
        const key = `${r.category}|${r.currency}`;
        const row = map.get(key) || { month, category: r.category, currency: r.currency, spent: 0, count: 0, limit: null };
        row.limit = r.limit_amount;
        map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));
}

export async function getBudget(db, ledgerId, month, category, currency) {
    return (await getBudgets(db, ledgerId, month)).find((b) => b.category === category && b.currency === currency) || null;
}

export async function setLimit(db, ledgerId, { month, category, currency, limit }) {
    if (limit == null) {
        await db.prepare('DELETE FROM budget_limits WHERE ledger_id = ? AND month = ? AND category = ? AND currency = ?').bind(ledgerId, month, category, currency).run();
    } else {
        await db
            .prepare(
                `INSERT INTO budget_limits (ledger_id, month, category, currency, limit_amount) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (ledger_id, month, category, currency) DO UPDATE SET limit_amount = excluded.limit_amount, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
            )
            .bind(ledgerId, month, category, currency, limit)
            .run();
    }
    return getBudget(db, ledgerId, month, category, currency);
}

export async function monthTotals(db, ledgerId, month) {
    const { results } = await db
        .prepare(
            `SELECT currency, type, SUM(amount) AS total, COUNT(*) AS count FROM transactions
             WHERE ledger_id = ? AND date LIKE ? GROUP BY currency, type`
        )
        .bind(ledgerId, `${month}-%`)
        .all();
    const totals = {};
    for (const r of results) {
        totals[r.currency] ??= { spent: 0, received: 0, count: 0 };
        totals[r.currency][r.type === 'income' ? 'received' : 'spent'] = round(r.total);
        totals[r.currency].count += r.count;
    }
    return totals;
}

export async function dailySpend(db, ledgerId, month, currency) {
    const { results } = await db
        .prepare(
            `SELECT date, SUM(amount) AS spent FROM transactions
             WHERE ledger_id = ? AND type = 'expense' AND currency = ? AND date LIKE ? GROUP BY date ORDER BY date`
        )
        .bind(ledgerId, currency, `${month}-%`)
        .all();
    return results.map((r) => ({ date: r.date, spent: round(r.spent) }));
}

export async function seedDemo(db, ledgerId, { rows, limits }) {
    const stmts = [db.prepare('DELETE FROM transactions WHERE ledger_id = ? AND is_demo = 1').bind(ledgerId)];
    for (const r of rows) stmts.push(insertStmt(db, ledgerId, r, true));
    for (const l of limits) {
        stmts.push(
            db
                .prepare(
                    `INSERT INTO budget_limits (ledger_id, month, category, currency, limit_amount) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (ledger_id, month, category, currency) DO NOTHING`
                )
                .bind(ledgerId, l.month, l.category, l.currency, l.limit)
        );
    }
    await db.batch(stmts);
    return rows.length;
}

export async function clearDemo(db, ledgerId) {
    const res = await db.prepare('DELETE FROM transactions WHERE ledger_id = ? AND is_demo = 1').bind(ledgerId).run();
    return res.meta.changes;
}

export async function clearLedger(db, ledgerId) {
    const [tx] = await db.batch([
        db.prepare('DELETE FROM transactions WHERE ledger_id = ?').bind(ledgerId),
        db.prepare('DELETE FROM budget_limits WHERE ledger_id = ?').bind(ledgerId),
    ]);
    return tx.meta.changes;
}

const round = (n) => Math.round(n * 100) / 100;
