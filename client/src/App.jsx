import { useCallback, useEffect, useState } from 'react';
import { api, localToday, money, prettyDate } from './api';
import Composer from './components/Composer';
import Review from './components/Review';
import Month from './components/Month';

const month = localToday().slice(0, 7);

function Saved({ saved, onAnother }) {
  const { transaction: t, budget: b } = saved;
  return (
    <section className="card saved" aria-live="polite">
      <div className="tick" aria-hidden="true">
        ✓
      </div>
      <div className="saved-body">
        <h2>Saved to your ledger</h2>
        <p>
          <strong>
            {t.type === 'income' ? '+' : '−'}
            {money(t.amount, t.currency)}
          </strong>{' '}
          · {t.category} · {prettyDate(t.date)}
          {t.merchant ? ` · ${t.merchant}` : ''}
        </p>
        {b && (
          <p className="muted">
            {t.category} total for {new Date(`${b.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long' })} is now <strong>{money(b.spent, b.currency)}</strong>
            {b.limit != null && <> of {money(b.limit, b.currency)}</>} across {b.count} {b.count === 1 ? 'entry' : 'entries'}.
          </p>
        )}
        <p className="tiny-print">Record id {t._id}</p>
      </div>
      <button className="btn primary" onClick={onAnother}>
        Add another
      </button>
    </section>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [meta, setMeta] = useState(null);
  const [stage, setStage] = useState('compose'); // compose | review | saved
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [composerKey, setComposerKey] = useState(0);

  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  const refresh = useCallback(async () => {
    setListLoading(true);
    try {
      const [tx, bd] = await Promise.all([api('/transactions'), api(`/budgets?month=${month}`)]);
      setTransactions(tx);
      setBudgets(bd.budgets);
      setListError('');
    } catch (err) {
      setListError(err.message);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    api('/health').then(setHealth).catch(() => setHealth({ ok: false }));
    api('/meta').then(setMeta).catch((err) => setError(err.message));
    refresh();
  }, [refresh]);

  async function read(note) {
    setBusy(true);
    setError('');
    try {
      const data = await api('/extract', { method: 'POST', body: { note, today: localToday() } });
      setResult(data);
      setStage('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onSaved(data) {
    setSaved(data);
    setStage('saved');
    refresh();
  }

  function startOver() {
    setStage('compose');
    setResult(null);
    setComposerKey((k) => k + 1);
  }

  async function remove(id) {
    try {
      await api(`/transactions/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setListError(err.message);
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            F
          </span>
          <div>
            <h1>FinPilot</h1>
            <p className="muted">Say what you spent. I’ll file it.</p>
          </div>
        </div>
        {health && (
          <div className="status">
            <span className={`pill ${health.engine === 'claude' ? 'good' : 'neutral'}`}>{health.engine === 'claude' ? 'AI: Claude' : 'AI: offline parser'}</span>
            <span className={`pill ${health.db === 'connected' ? 'good' : 'bad'}`}>{health.db === 'connected' ? 'Database connected' : 'Database offline'}</span>
          </div>
        )}
      </header>

      <main className="layout">
        <div className="flow">
          <ol className="steps" aria-label="Progress">
            <li className={stage === 'compose' ? 'on' : 'done'}>Describe</li>
            <li className={stage === 'review' ? 'on' : stage === 'saved' ? 'done' : ''}>Review</li>
            <li className={stage === 'saved' ? 'on' : ''}>Saved</li>
          </ol>

          {stage === 'compose' && <Composer key={composerKey} busy={busy || !meta} onSubmit={read} />}
          {error && stage === 'compose' && <p className="hint error banner">{error}</p>}
          {stage === 'review' && result && meta && <Review result={result} meta={meta} onSaved={onSaved} onDiscard={startOver} />}
          {stage === 'saved' && saved && <Saved saved={saved} onAnother={startOver} />}

          <p className="privacy">
            Your ledger is private to this browser. Card numbers, OTPs, phone numbers and emails are stripped out before anything is processed. Nothing is saved until you press <em>Save</em>.
          </p>
        </div>

        <Month
          month={month}
          budgets={budgets}
          transactions={transactions}
          loading={listLoading}
          error={listError}
          freshId={saved?.transaction?._id}
          onRefresh={refresh}
          onDelete={remove}
        />
      </main>
    </div>
  );
}
