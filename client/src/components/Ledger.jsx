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
      <form className="card modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="edit-title">
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

function Entry({ t, onDelete, onEdit, highlight }) {
  const [asking, setAsking] = useState(false);
  return (
    <li className={`entry ${highlight ? 'fresh' : ''}`}>
      <div className="entry-main">
        <span className="entry-title">
          {t.description || t.merchant || t.category}
          {t.isDemo && <span className="demo-tag">demo</span>}
        </span>
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
            <button className="link danger" onClick={() => onDelete(t.id)}>
              Yes
            </button>{' '}
            <button className="link" onClick={() => setAsking(false)}>
              No
            </button>
          </span>
        ) : (
          <span className="entry-actions">
            <button className="link quiet" onClick={() => onEdit(t)}>
              Edit
            </button>
            <button className="link quiet" onClick={() => setAsking(true)} aria-label="Delete entry">
              Remove
            </button>
          </span>
        )}
      </div>
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
    <section className="card ledger">
      <div className="ledger-head">
        <h2>Ledger</h2>
        <button className="btn tiny" onClick={onExport} disabled={!transactions.length}>
          Export CSV
        </button>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search merchant or note…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ledger" />
        <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} aria-label="Filter by category">
          <option value="">All categories</option>
          {meta?.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div className="seg small-seg" role="radiogroup" aria-label="Filter by type">
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
        <p className="muted">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="muted empty-chart">{filtered ? 'Nothing matches these filters.' : 'Your saved entries for this month will show up here.'}</p>
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
