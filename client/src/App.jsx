import { useCallback, useEffect, useState } from 'react';
import { api, applyTheme, download, loadAi, loadTheme, localToday, money, monthLabel, prettyDate, saveAi, shiftMonth } from './api';
import { AiSettings, AskPanel } from './components/AiPanels';
import Composer from './components/Composer';
import Review from './components/Review';
import Ledger from './components/Ledger';
import { Budgets, DailyChart, Insights, KpiStrip } from './components/Dashboard';

const thisMonth = () => localToday().slice(0, 7);
const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' };

function Saved({ saved, onAnother }) {
  const { transaction: t, budget: b } = saved;
  return (
    <section className="panel saved" aria-live="polite">
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
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              F
            </span>
            <span className="brand-name">FinPilot</span>
          </div>

          <nav className="month-nav" aria-label="Month">
            <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="month-label">{monthLabel(month)}</span>
            <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={atCurrent} aria-label="Next month">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            {!atCurrent && (
              <button className="link" onClick={() => setMonth(thisMonth())}>
                Today
              </button>
            )}
          </nav>

          <div className="topbar-actions">
            {health && <AiSettings meta={meta} health={health} ai={ai} setAi={setAi} />}
            {health && <span className={`status-dot ${health.db === 'connected' ? 'ok' : 'bad'}`} title={health.db === 'connected' ? 'Database connected (Cloudflare D1)' : 'Database offline'} />}
            <button className="icon-btn" onClick={() => setTheme(NEXT_THEME[theme])} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Click to change.`}>
              {theme === 'dark' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
                </svg>
              ) : theme === 'light' ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="8" />
                  <path d="M12 4v16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="page">
        {isEmpty && month === thisMonth() ? (
          <section className="welcome">
            <div>
              <h1>Track spending by just describing it.</h1>
              <p className="muted">Type, speak or snap a receipt. Or load a sample month to explore everything first.</p>
            </div>
            <button className="btn primary" onClick={loadDemo} disabled={demoBusy}>
              {demoBusy ? 'Loading…' : 'Load sample data'}
            </button>
          </section>
        ) : (
          <div className="page-head">
            <h1>{monthLabel(month)}</h1>
            <div className="page-actions">
              {hasDemo ? (
                <button className="btn small" onClick={clearDemo} disabled={demoBusy}>
                  Clear sample data
                </button>
              ) : (
                <button className="btn small" onClick={loadDemo} disabled={demoBusy}>
                  Load sample data
                </button>
              )}
            </div>
          </div>
        )}

        {summary && <KpiStrip summary={summary} />}

        <main className="grid">
          <div className="col">
            {stage === 'compose' && <Composer key={composerKey} busy={busy || !meta} onSubmit={read} onReceipt={readReceipt} aiAvailable={Boolean(meta?.ai?.available)} />}
            {error && stage === 'compose' && <p className="hint error">{error}</p>}
            {stage === 'review' && result && meta && <Review result={result} meta={meta} receipt={receipt} onSaved={onSaved} onDiscard={startOver} />}
            {stage === 'saved' && saved && <Saved saved={saved} onAnother={startOver} />}

            {summary && <DailyChart summary={summary} />}

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
          </div>

          <aside className="col side">
            {summary && <Budgets summary={summary} onChanged={refresh} />}
            {summary && <Insights insights={summary.insights} />}
            <AskPanel month={month} ai={ai} available={Boolean(meta?.ai?.available)} hasData={Boolean(summary && Object.keys(summary.totals).length)} />
          </aside>
        </main>

        <footer className="foot">
          <span>Private to this browser · card numbers, OTPs, phones and emails are stripped before processing</span>
          <span>Cloudflare Workers + D1{meta?.ai?.available ? ' · Claude' : ''}</span>
        </footer>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
