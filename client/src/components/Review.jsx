import { useMemo, useState } from 'react';
import { api, localToday, money, newDraftId, PAYMENT_LABELS } from '../api';

const REQUIRED = ['type', 'amount', 'currency', 'category', 'date'];

const STATUS_TEXT = {
  ok: 'Found',
  assumed: 'Assumed',
  missing: 'Missing',
  invalid: 'Check this',
  edited: 'Edited by you',
};

export default function Review({ result, meta, onSaved, onDiscard }) {
  const initial = useMemo(() => Object.fromEntries(Object.entries(result.fields).map(([k, f]) => [k, f.value ?? ''])), [result]);
  const [values, setValues] = useState(initial);
  const [edited, setEdited] = useState(() => new Set());
  const [serverFields, setServerFields] = useState(result.fields);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draftId] = useState(newDraftId);

  const set = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setEdited((s) => new Set(s).add(name));
    setError('');
  };

  // What each field's badge should say right now.
  function statusOf(name) {
    const v = values[name];
    const empty = v === '' || v == null;
    if (edited.has(name)) {
      if (REQUIRED.includes(name) && empty) return { status: 'missing', message: 'Required.' };
      if (name === 'amount' && !(Number(v) > 0)) return { status: 'invalid', message: 'Must be more than zero.' };
      if (name === 'date' && v > localToday()) return { status: 'invalid', message: 'Date is in the future.' };
      return { status: empty ? 'missing' : 'edited', message: empty ? 'Optional.' : null };
    }
    return serverFields[name];
  }

  const blocking = REQUIRED.filter((f) => !['ok', 'assumed', 'edited'].includes(statusOf(f).status));
  const amount = Number(values.amount);
  const isLarge = amount >= meta.largeAmount;
  const canSave = blocking.length === 0 && (!isLarge || confirmLarge) && !saving;

  async function save() {
    setSaving(true);
    setError('');
    try {
      const draft = { ...values, amount: values.amount === '' ? null : Number(values.amount) };
      for (const k of Object.keys(draft)) if (draft[k] === '') draft[k] = null;
      const data = await api('/transactions', {
        method: 'POST',
        body: { draft, draftId, confirmLarge, engine: result.engine, note: result.redactedNote, editedFields: [...edited], today: localToday() },
      });
      onSaved(data);
    } catch (err) {
      if (err.code === 'VALIDATION_FAILED' && err.fields) {
        setServerFields(err.fields);
        setEdited(new Set());
      }
      setError(err.message);
      setSaving(false);
    }
  }

  const field = (name, label, input) => {
    const s = statusOf(name) || { status: 'missing' };
    return (
      <div className={`field ${s.status}`} key={name}>
        <div className="field-head">
          <label htmlFor={`f-${name}`}>
            {label}
            {REQUIRED.includes(name) ? '' : <span className="opt"> optional</span>}
          </label>
          <span className={`badge ${s.status}`}>{STATUS_TEXT[s.status]}</span>
        </div>
        {input}
        {s.message && <p className="field-msg">{s.message}</p>}
      </div>
    );
  };

  return (
    <section className="card review" aria-live="polite">
      <header className="review-head">
        <div>
          <h2>Here’s what I understood</h2>
          <p className="muted">Check the fields, fix anything that’s off, then save.</p>
        </div>
        <span className={`engine ${result.engine}`}>{result.engine === 'claude' ? 'Read by Claude AI' : 'Offline parser'}</span>
      </header>

      <blockquote className="quote">“{result.redactedNote}”</blockquote>

      {[...result.notices, ...result.ambiguities].map((n) => (
        <p className="note-box" key={n}>
          {n}
        </p>
      ))}

      <div className="fields">
        {field(
          'type',
          'Type',
          <div className="seg" id="f-type" role="radiogroup">
            {['expense', 'income'].map((t) => (
              <button type="button" key={t} role="radio" aria-checked={values.type === t} className={values.type === t ? 'on' : ''} onClick={() => set('type', t)}>
                {t === 'expense' ? 'Money out' : 'Money in'}
              </button>
            ))}
          </div>
        )}
        {field(
          'amount',
          'Amount',
          <div className="amount-row">
            <select aria-label="Currency" value={values.currency} onChange={(e) => set('currency', e.target.value)}>
              {meta.currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input id="f-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" value={values.amount} onChange={(e) => set('amount', e.target.value)} />
            {statusOf('currency').status === 'assumed' && <span className="assumed-tag" title={statusOf('currency').message}>currency assumed</span>}
          </div>
        )}
        {field(
          'category',
          'Category',
          <select id="f-category" value={values.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">Choose…</option>
            {meta.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        {field(
          'date',
          'Date',
          <div className="date-row">
            <input id="f-date" type="date" max={localToday()} value={values.date} onChange={(e) => set('date', e.target.value)} />
            {!values.date && (
              <button type="button" className="btn tiny" onClick={() => set('date', localToday())}>
                Use today
              </button>
            )}
          </div>
        )}
        {field('merchant', 'Paid to / from', <input id="f-merchant" type="text" maxLength={80} placeholder="Shop or person" value={values.merchant} onChange={(e) => set('merchant', e.target.value)} />)}
        {field(
          'paymentMethod',
          'Paid with',
          <select id="f-paymentMethod" value={values.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
            <option value="">Not mentioned</option>
            {meta.paymentMethods.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_LABELS[p]}
              </option>
            ))}
          </select>
        )}
        {field('description', 'Description', <input id="f-description" type="text" maxLength={80} value={values.description} onChange={(e) => set('description', e.target.value)} />)}
      </div>

      {isLarge && blocking.length === 0 && (
        <label className="confirm-large">
          <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
          <span>
            This is a large amount. I’ve checked that <strong>{money(amount, values.currency)}</strong> is correct.
          </span>
        </label>
      )}

      {blocking.length > 0 && <p className="hint warn">Fill in the {blocking.join(' and ').replace(/ and (?=.* and )/g, ', ')} to save.</p>}
      {error && <p className="hint error">{error}</p>}

      <div className="review-actions">
        <button type="button" className="btn ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </button>
        <button type="button" className="btn primary" onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save to ledger'}
        </button>
      </div>
    </section>
  );
}
