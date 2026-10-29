import { useEffect, useState } from 'react';
import { api, localToday, money, prettyDate, PAYMENT_LABELS } from '../api';

function EditDialog({ t, meta, onClose, onSaved }) {
  const [v, setV] = useState({
    type: t.type,
    amount: t.amount,
    currency: t.currency,
    category: t.category,
    date: t.date,
    merchant: t.merchant || '',
    paymentMethod: t.paymentMethod || '',
    description: t.description || '',
  });
  const [edited, setEdited] = useState(() => new Set(t.source?.editedFields || []));
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, value) => {
    setV((s) => ({ ...s, [k]: value }));
    setEdited((s) => new Set(s).add(k));
  };
  const isLarge = Number(v.amount) >= meta.largeAmount;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const draft = { ...v, amount: v.amount === '' ? null : Number(v.amount) };
      for (const k of Object.keys(draft)) if (draft[k] === '') draft[k] = null;
      await api(`/transactions/${t.id}`, { method: 'PATCH', body: { draft, confirmLarge, editedFields: [...edited], today: localToday() } });
      onSaved();
    } catch (err) {
      const firstBad = err.fields && Object.entries(err.fields).find(([k]) => (err.blocking || []).includes(k));
      setError(firstBad ? `${firstBad[0]}: ${firstBad[1].message}` : err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <h2 id="edit-title">Edit entry</h2>
        <div className="fields">
          <div className="field">
            <label>Type</label>
            <div className="seg" role="radiogroup">
              {['expense', 'income'].map((x) => (
                <button type="button" key={x} role="radio" aria-checked={v.type === x} className={v.type === x ? 'on' : ''} onClick={() => set('type', x)}>
                  {x === 'expense' ? 'Money out' : 'Money in'}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="e-amount">Amount</label>
            <div className="amount-row">
              <select aria-label="Currency" value={v.currency} onChange={(e) => set('currency', e.target.value)}>
                {meta.currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input id="e-amount" type="number" min="0" step="0.01" value={v.amount} onChange={(e) => set('amount', e.target.value)} required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="e-category">Category</label>
            <select id="e-category" value={v.category} onChange={(e) => set('category', e.target.value)}>
              {meta.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-date">Date</label>
            <input id="e-date" type="date" max={localToday()} value={v.date} onChange={(e) => set('date', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="e-merchant">Paid to / from</label>
            <input id="e-merchant" maxLength={80} value={v.merchant} onChange={(e) => set('merchant', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e-pm">Paid with</label>
            <select id="e-pm" value={v.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
              <option value="">Not mentioned</option>
              {meta.paymentMethods.map((p) => (
                <option key={p} value={p}>
                  {PAYMENT_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field wide">
            <label htmlFor="e-desc">Description</label>
            <input id="e-desc" maxLength={80} value={v.description} onChange={(e) => set('description', e.target.value)} />
          </div>
        </div>
        {isLarge && (
          <label className="confirm-large">
            <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
            <span>
              I’ve checked that <strong>{money(Number(v.amount), v.currency)}</strong> is correct.
            </span>
          </label>
        )}
        {error && <p className="hint error">{error}</p>}
        <div className="review-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || (isLarge && !confirmLarge)}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

const CATEGORY_GLYPH = {
  'Food & Dining': '🍽',
  Groceries: '🛒',
  Transport: '🚕',
  Shopping: '🛍',
  'Bills & Utilities': '💡',
  'Rent & Housing': '🏠',
  Health: '⚕',
  Entertainment: '🎬',
  Travel: '✈',
  Education: '📚',
  'Personal Care': '✂',
  'Gifts & Donations': '🎁',
  'Salary & Income': '₹',
  Other: '•',
};

function Entry({ t, onDelete, onEdit, highlight }) {
  const [asking, setAsking] = useState(false);
  return (
    <li className={`entry ${highlight ? 'fresh' : ''}`}>
      <span className={`glyph ${t.type}`} aria-hidden="true">
        {CATEGORY_GLYPH[t.category] || '•'}
      </span>
      <div className="entry-main">
        <span className="entry-title">
          {t.description || t.merchant || t.category}
          {t.isDemo && <span className="tag">Demo</span>}
        </span>
        <span className="entry-sub">
          {t.category}
          {t.merchant && t.description ? ` · ${t.merchant}` : ''}
          {t.paymentMethod ? ` · ${PAYMENT_LABELS[t.paymentMethod]}` : ''}
        </span>
      </div>
      <span className="entry-date">{prettyDate(t.date).replace(/ \d{4}$/, '')}</span>
      <span className={`entry-amt ${t.type}`}>
        {t.type === 'income' ? '+' : '−'}
        {money(t.amount, t.currency)}
      </span>
      <span className="entry-actions">
        {asking ? (
          <>
            <button className="btn small danger" onClick={() => onDelete(t.id)}>
              Delete
            </button>
            <button className="btn small" onClick={() => setAsking(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button className="row-action" onClick={() => onEdit(t)} aria-label="Edit entry" title="Edit">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
              </svg>
            </button>
            <button className="row-action" onClick={() => setAsking(true)} aria-label="Delete entry" title="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
              </svg>
            </button>
          </>
        )}
      </span>
    </li>
  );
}

export default function Ledger({ meta, transactions, loading, error, filters, setFilters, freshId, onRefresh, onDelete, onExport }) {
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState(filters.q);

  // Debounce typing in the search box.
  useEffect(() => {
    const id = setTimeout(() => q !== filters.q && setFilters((f) => ({ ...f, q })), 250);
    return () => clearTimeout(id);
  }, [q, filters.q, setFilters]);

  const filtered = filters.q || filters.category || filters.type;

  return (
    <section className="panel ledger">
      <div className="panel-head">
        <h2 className="panel-title">
          Transactions <span className="count">{transactions.length}</span>
        </h2>
        <button className="btn small" onClick={onExport} disabled={!transactions.length}>
          Export CSV
        </button>
      </div>
      <div className="filters">
        <div className="search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
          <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        </div>
        <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} aria-label="Filter by category">
          <option value="">All categories</option>
          {meta?.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div className="seg" role="radiogroup" aria-label="Filter by type">
          {[
            ['', 'All'],
            ['expense', 'Out'],
            ['income', 'In'],
          ].map(([val, label]) => (
            <button type="button" key={label} role="radio" aria-checked={filters.type === val} className={filters.type === val ? 'on' : ''} onClick={() => setFilters((f) => ({ ...f, type: val }))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="hint error">
          {error}{' '}
          <button className="link" onClick={onRefresh}>
            Retry
          </button>
        </p>
      )}
      {loading && transactions.length === 0 ? (
        <p className="empty">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="empty">{filtered ? 'No transactions match these filters.' : 'No transactions this month yet.'}</p>
      ) : (
        <ul className="entries">
          {transactions.map((t) => (
            <Entry key={t.id} t={t} onDelete={onDelete} onEdit={setEditing} highlight={t.id === freshId} />
          ))}
        </ul>
      )}
      {editing && meta && (
        <EditDialog
          t={editing}
          meta={meta}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onRefresh();
          }}
        />
      )}
    </section>
  );
}
