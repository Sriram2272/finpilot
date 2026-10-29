// Plain-English observations about a month, computed from the numbers (no AI needed).
// Each insight is { kind: 'good' | 'warn' | 'info', text }.

export function money(amount, currency = 'INR') {
    try {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
    } catch {
        return `${currency} ${Math.round(amount)}`;
    }
}

const daysIn = (month) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function buildInsights({ month, today, currency, totals, prevTotals, budgets, daily, prevDaily }) {
    const out = [];
    const cur = totals[currency] || { spent: 0, received: 0 };
    const prev = prevTotals[currency] || { spent: 0, received: 0 };
    const isCurrent = today.slice(0, 7) === month;
    const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : daysIn(month);

    if (cur.spent === 0 && cur.received === 0) return out;

    // Month-to-date versus the same days last month, so a half-finished month isn't compared to a full one.
    const prevSameDays = prevDaily.filter((d) => Number(d.date.slice(8, 10)) <= dayOfMonth).reduce((s, d) => s + d.spent, 0);
    if (prevSameDays > 0 && cur.spent > 0) {
        const pct = Math.round(((cur.spent - prevSameDays) / prevSameDays) * 100);
        if (Math.abs(pct) >= 3) {
            out.push({
                kind: pct > 0 ? 'warn' : 'good',
                text: `You've spent ${Math.abs(pct)}% ${pct > 0 ? 'more' : 'less'} than at this point last month (${money(prevSameDays, currency)}).`,
            });
        } else {
            out.push({ kind: 'info', text: `Spending is level with this point last month.` });
        }
    }

    if (isCurrent && dayOfMonth >= 5 && dayOfMonth < daysIn(month) && cur.spent > 0) {
        const projected = (cur.spent / dayOfMonth) * daysIn(month);
        out.push({ kind: 'info', text: `At this pace you'll spend about ${money(projected, currency)} by the end of the month.` });
    }

    const expenseRows = budgets.filter((b) => b.currency === currency && b.spent > 0);
    if (expenseRows.length && cur.spent > 0) {
        const top = expenseRows[0];
        out.push({ kind: 'info', text: `${top.category} is your biggest category: ${money(top.spent, currency)} (${Math.round((top.spent / cur.spent) * 100)}% of spending).` });
    }

    for (const b of budgets.filter((b) => b.limit != null && b.currency === currency)) {
        if (b.spent > b.limit) out.push({ kind: 'warn', text: `Over your ${b.category} budget by ${money(b.spent - b.limit, currency)}.` });
        else if (b.limit > 0 && b.spent / b.limit >= 0.8) out.push({ kind: 'warn', text: `${b.category} is at ${Math.round((b.spent / b.limit) * 100)}% of its budget.` });
    }

    if (cur.received > 0) {
        const kept = Math.round(((cur.received - cur.spent) / cur.received) * 100);
        out.push(
            kept >= 0
                ? { kind: kept >= 20 ? 'good' : 'info', text: `You've kept ${kept}% of what came in this month (${money(cur.received - cur.spent, currency)}).` }
                : { kind: 'warn', text: `You've spent ${money(cur.spent - cur.received, currency)} more than came in this month.` }
        );
    }

    if (daily.length) {
        const biggest = daily.reduce((a, b) => (b.spent > a.spent ? b : a));
        const label = new Date(`${biggest.date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        if (daily.length > 3) out.push({ kind: 'info', text: `Your heaviest day was ${label} at ${money(biggest.spent, currency)}.` });
    }

    return out;
}
