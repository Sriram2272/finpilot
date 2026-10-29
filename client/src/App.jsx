import { useCallback, useEffect, useState } from 'react';
import { api, applyTheme, download, loadAi, loadTheme, localToday, money, monthLabel, prettyDate, saveAi, shiftMonth } from './api';
import { AiSettings, AskPanel } from './components/AiPanels';
import Composer from './components/Composer';
import Review from './components/Review';
import Ledger from './components/Ledger';
import { CategoryChart, DailyChart, Insights, StatTiles } from './components/Dashboard';

const thisMonth = () => localToday().slice(0, 7);
const THEMES = { system: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' };

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
            {t.category} total for {monthLabel(b.month, { month: 'long' })} is now <strong>{money(b.spent, b.currency)}</strong>
            {b.limit != null && <> of {money(b.limit, b.currency)}</>} across {b.count} {b.count === 1 ? 'entry' : 'entries'}.
          </p>
        )}
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
  const [theme, setTheme] = useState(loadTheme);
  const [month, setMonth] = useState(thisMonth);
  const [ai, setAiState] = useState(loadAi);
  const [receipt, setReceipt] = useState('');
  const setAi = (next) => {
    setAiState(next);
    saveAi(next);
  };

  const [stage, setStage] = useState('compose'); // compose | review | saved
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [composerKey, setComposerKey] = useState(0);

  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState({ q: '', category: '', type: '' });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => applyTheme(theme), [theme]);

  const refresh = useCallback(async () => {
    setListLoading(true);
    try {
      const qs = new URLSearchParams({ month, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
      const [tx, sm] = await Promise.all([api(`/transactions?${qs}`), api(`/summary?month=${month}`)]);
      setTransactions(tx);
      setSummary(sm);
      setListError('');
    } catch (err) {
      setListError(err.message);
    } finally {
      setListLoading(false);
    }
  }, [month, filters]);

  useEffect(() => {
    api('/health').then(setHealth).catch(() => setHealth({ ok: false }));
    api('/meta').then(setMeta).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  async function read(note) {
    setBusy(true);
    setError('');
    try {
      const data = await api('/extract', { method: 'POST', body: { note, today: localToday(), ai } });
      setReceipt('');
      setResult(data);
      setStage('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function readReceipt(image) {
    setBusy(true);
    setError('');
    try {
      const data = await api('/extract-receipt', { method: 'POST', body: { image, today: localToday(), ai } });
      setReceipt(image);
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
    const savedMonth = data.transaction.date.slice(0, 7);
    if (savedMonth !== month) setMonth(savedMonth);
    else refresh();
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

  async function loadDemo() {
    setDemoBusy(true);
    try {
      const { seeded } = await api('/demo', { method: 'POST', body: { today: localToday() } });
      setMonth(thisMonth());
      setFilters({ q: '', category: '', type: '' });
      await refresh();
      setToast(`Loaded ${seeded} demo entries across this month and last.`);
    } catch (err) {
      setToast(err.message);
    } finally {
      setDemoBusy(false);
    }
  }

  async function clearDemo() {
    setDemoBusy(true);
    try {
      const { removed } = await api('/demo', { method: 'DELETE' });
      await refresh();
      setToast(`Removed ${removed} demo entries. Your own entries were kept.`);
    } catch (err) {
      setToast(err.message);
    } finally {
      setDemoBusy(false);
    }
  }

  async function exportCsv() {
    try {
      await download(`/export.csv?month=${month}`, `finpilot-${month}.csv`);
    } catch (err) {
      setToast(err.message);
    }
  }

  const hasDemo = transactions.some((t) => t.isDemo);
  const isEmpty = summary && Object.keys(summary.totals).length === 0 && !filters.q && !filters.category && !filters.type;
  const atCurrent = month >= thisMonth();

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
        <div className="status">
          {health && (
            <>
              <AiSettings meta={meta} health={health} ai={ai} setAi={setAi} />
              <span className={`pill ${health.db === 'connected' ? 'good' : 'bad'}`}>{health.db === 'connected' ? 'Cloudflare D1 connected' : 'Database offline'}</span>
            </>
          )}
          <button className="pill theme-btn" onClick={() => setTheme(NEXT_THEME[theme])} aria-label={`Theme: ${theme}. Click to change.`}>
            {THEMES[theme]}
          </button>
        </div>
      </header>

      <nav className="toolbar" aria-label="Month">
        <div className="month-nav">
          <button className="btn tiny" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
            ‹
          </button>
          <strong>{monthLabel(month)}</strong>
          <button className="btn tiny" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={atCurrent} aria-label="Next month">
            ›
          </button>
          {!atCurrent && (
            <button className="link" onClick={() => setMonth(thisMonth())}>
              Today
            </button>
          )}
        </div>
        <div className="demo-actions">
          <button className="btn tiny" onClick={loadDemo} disabled={demoBusy}>
            {demoBusy ? 'Working…' : '✨ Load demo data'}
          </button>
          {hasDemo && (
            <button className="btn tiny ghost" onClick={clearDemo} disabled={demoBusy}>
              Clear demo
            </button>
          )}
        </div>
      </nav>

      {isEmpty && month === thisMonth() && (
        <section className="demo-banner">
          <div>
            <strong>New here?</strong> Load a realistic demo month to explore the dashboard, budgets, insights, editing and CSV export. Demo entries are tagged and can be cleared any time.
          </div>
          <button className="btn primary" onClick={loadDemo} disabled={demoBusy}>
            Try the demo
          </button>
        </section>
      )}

      <main className="layout">
        <div className="flow">
          <ol className="steps" aria-label="Progress">
            <li className={stage === 'compose' ? 'on' : 'done'}>Describe</li>
            <li className={stage === 'review' ? 'on' : stage === 'saved' ? 'done' : ''}>Review</li>
            <li className={stage === 'saved' ? 'on' : ''}>Saved</li>
          </ol>

          {stage === 'compose' && <Composer key={composerKey} busy={busy || !meta} onSubmit={read} onReceipt={readReceipt} aiAvailable={Boolean(meta?.ai?.available)} />}
          {error && stage === 'compose' && <p className="hint error banner">{error}</p>}
          {stage === 'review' && result && meta && <Review result={result} meta={meta} receipt={receipt} onSaved={onSaved} onDiscard={startOver} />}
          {stage === 'saved' && saved && <Saved saved={saved} onAnother={startOver} />}

          <p className="privacy">
            Your ledger is private to this browser. Card numbers, OTPs, phone numbers and emails are stripped out before anything is processed. Nothing is saved until you press <em>Save</em>.
          </p>
        </div>

        <aside className="card overview">
          <h2>{monthLabel(month)}</h2>
          {summary ? (
            <>
              <StatTiles summary={summary} />
              <Insights insights={summary.insights} />
              {Object.keys(summary.totals).length === 0 && <p className="muted">Nothing logged this month yet.</p>}
            </>
          ) : (
            <p className="muted">{listError || 'Loading…'}</p>
          )}
        </aside>
      </main>

      {summary && (
        <section className="charts">
          <div className="card">
            <DailyChart summary={summary} />
          </div>
          <div className="card">
            <CategoryChart summary={summary} onChanged={refresh} />
          </div>
        </section>
      )}

      <AskPanel month={month} ai={ai} available={Boolean(meta?.ai?.available)} hasData={Boolean(summary && Object.keys(summary.totals).length)} />

      <Ledger
        meta={meta}
        transactions={transactions}
        loading={listLoading}
        error={listError}
        filters={filters}
        setFilters={setFilters}
        freshId={saved?.transaction?.id}
        onRefresh={refresh}
        onDelete={remove}
        onExport={exportCsv}
      />

      <footer className="foot muted">FinPilot · Cloudflare Workers + D1 · {meta?.ai?.available ? 'Claude' : 'offline parser'}</footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
