import { useState } from 'react';
import { api, money, prettyDate, PAYMENT_LABELS } from '../api';

function BudgetRow({ b, month, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(b.limit ?? '');
  const [err, setErr] = useState('');
  const pct = b.limit ? Math.min(100, (b.spent / b.limit) * 100) : 0;
  const over = b.limit != null && b.spent > b.limit;

  async function save(e) {
    e.preventDefault();
    try {
      await api('/budgets', { method: 'PUT', body: { month, category: b.category, currency: b.currency, limit: limit === '' ? null : Number(limit) } });
      setEditing(false);
      setErr('');
      onChanged();
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <li className={`budget ${over ? 'over' : ''}`}>
      <div className="budget-top">
        <span className="budget-cat">{b.category}</span>
        <span className="budget-num">
          {money(b.spent, b.currency)}
          {b.limit != null && <span className="muted"> / {money(b.limit, b.currency)}</span>}
        </span>
      </div>
      {b.limit != null && (
        <div className="bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {editing ? (
        <form className="limit-form" onSubmit={save}>
          <input type="number" min="0" placeholder="Monthly limit" value={limit} onChange={(e) => setLimit(e.target.value)} autoFocus />
          <button className="btn tiny primary">Set</button>
          <button type="button" className="btn tiny" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="link" onClick={() => setEditing(true)}>
          {b.limit != null ? 'Change limit' : 'Set a limit'}
        </button>
      )}
      {over && <p className="field-msg">Over budget by {money(b.spent - b.limit, b.currency)}</p>}
      {err && <p className="hint error">{err}</p>}
    </li>
  );
}

function Entry({ t, onDelete, highlight }) {
  const [asking, setAsking] = useState(false);
  return (
    <li className={`entry ${highlight ? 'fresh' : ''}`}>
      <div className="entry-main">
        <span className="entry-title">{t.description || t.merchant || t.category}</span>
        <span className="entry-sub">
          {prettyDate(t.date)} · {t.category}
          {t.merchant && t.description ? ` · ${t.merchant}` : ''}
          {t.paymentMethod ? ` · ${PAYMENT_LABELS[t.paymentMethod]}` : ''}
        </span>
      </div>
      <div className="entry-side">
        <span className={`entry-amt ${t.type}`}>
          {t.type === 'income' ? '+' : '−'}
          {money(t.amount, t.currency)}
        </span>
        {asking ? (
          <span className="ask">
            Delete?{' '}
            <button className="link danger" onClick={() => onDelete(t._id)}>
              Yes
            </button>{' '}
            <button className="link" onClick={() => setAsking(false)}>
              No
            </button>
          </span>
        ) : (
          <button className="link quiet" onClick={() => setAsking(true)} aria-label="Delete entry">
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

export default function Month({ month, budgets, transactions, loading, error, freshId, onRefresh, onDelete }) {
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const inMonth = transactions.filter((t) => t.date.startsWith(month));
  const totals = {};
  for (const t of inMonth) {
    totals[t.currency] ??= { spent: 0, received: 0 };
    totals[t.currency][t.type === 'income' ? 'received' : 'spent'] += t.amount;
  }

  return (
    <aside className="month">
      <section className="card">
        <h2>{label}</h2>
        {Object.keys(totals).length === 0 ? (
          <p className="muted">Nothing logged this month yet.</p>
        ) : (
          Object.entries(totals).map(([cur, t]) => (
            <div className="totals" key={cur}>
              <div>
                <span className="muted">Spent</span>
                <strong>{money(t.spent, cur)}</strong>
              </div>
              <div>
                <span className="muted">Received</span>
                <strong className="pos">{money(t.received, cur)}</strong>
              </div>
            </div>
          ))
        )}
        {budgets.length > 0 && (
          <>
            <h3>By category</h3>
            <ul className="budgets">
              {budgets.map((b) => (
                <BudgetRow key={b._id} b={b} month={month} onChanged={onRefresh} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>Ledger</h2>
        {error && (
          <p className="hint error">
            {error}{' '}
            <button className="link" onClick={onRefresh}>
              Retry
            </button>
          </p>
        )}
        {loading && transactions.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="muted">Your saved entries will show up here.</p>
        ) : (
          <ul className="entries">
            {transactions.map((t) => (
              <Entry key={t._id} t={t} onDelete={onDelete} highlight={t._id === freshId} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
