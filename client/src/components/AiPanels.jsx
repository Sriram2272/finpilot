import { useEffect, useRef, useState } from 'react';
import { api, aiSummary } from '../api';

const EFFORT_HELP = {
  low: 'Quickest. Plenty for everyday notes.',
  medium: 'A bit more care on tricky notes.',
  high: 'Thinks harder. Good for messy receipts.',
  xhigh: 'Very thorough, noticeably slower.',
  max: 'Maximum reasoning. Slowest and costliest.',
};

// Header pill + popover for choosing the Claude model and effort level.
export function AiSettings({ meta, health, ai, setAi }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!health) return null;
  if (!meta?.ai?.available) return <span className="pill neutral">AI: offline parser</span>;

  const current = ai || meta.ai.default;
  const model = meta.ai.models.find((m) => m.id === current.model) || meta.ai.models[0];

  return (
    <div className="ai-settings" ref={ref}>
      <button className="pill good ai-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        AI: {model.label.replace('Claude ', '')} · {current.effort}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div className="ai-pop card" role="dialog" aria-label="AI settings">
          <h3>Model</h3>
          <div className="model-list" role="radiogroup">
            {meta.ai.models.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={m.id === current.model}
                className={`model-opt ${m.id === current.model ? 'on' : ''}`}
                onClick={() => setAi({ ...current, model: m.id })}
              >
                <strong>{m.label}</strong>
                <span className="muted small">{m.note}</span>
              </button>
            ))}
          </div>
          <h3>Effort</h3>
          <div className="seg" role="radiogroup" aria-label="Effort">
            {meta.ai.efforts.map((e) => (
              <button key={e} role="radio" aria-checked={e === current.effort} className={e === current.effort ? 'on' : ''} onClick={() => setAi({ ...current, effort: e })}>
                {e}
              </button>
            ))}
          </div>
          <p className="muted small effort-help">{EFFORT_HELP[current.effort]}</p>
          <div className="ai-pop-foot">
            <button className="link" onClick={() => setAi(null)}>
              Reset to default
            </button>
            <button className="btn tiny primary" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS = ['Where did most of my money go?', 'Am I on track with my budgets?', 'How does this month compare to last month?', 'Any subscriptions I could cut?'];

// Ask a question about this month's ledger, answered by Claude from the user's own data.
export function AskPanel({ month, ai, available, hasData }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api('/ask', { method: 'POST', body: { question: text, month, ai } });
      setHistory((h) => [{ q: text, ...res }, ...h].slice(0, 4));
      setQuestion('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card ask">
      <div className="ask-head">
        <h2>Ask FinPilot</h2>
        <span className="muted small">answers from your ledger only</span>
      </div>
      {!available ? (
        <p className="muted">Ask questions about your spending once Claude is enabled on the server.</p>
      ) : (
        <>
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder={hasData ? 'e.g. How much did I spend on food?' : 'Log something or load the demo first'} aria-label="Ask a question about your spending" disabled={busy} />
            <button className="btn primary" disabled={busy || !question.trim()}>
              {busy ? 'Thinking…' : 'Ask'}
            </button>
          </form>
          <div className="examples">
            {SUGGESTIONS.map((s) => (
              <button type="button" key={s} className="chip" onClick={() => ask(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
          {error && <p className="hint error">{error}</p>}
          {busy && <p className="muted small thinking">Reading your ledger…</p>}
          <ul className="answers">
            {history.map((h, i) => (
              <li key={`${h.q}-${i}`} className="answer">
                <p className="answer-q">{h.q}</p>
                <div className="answer-a">
                  {h.answer.split('\n').map((line, j) => (line.trim() ? <p key={j}>{line}</p> : null))}
                </div>
                <p className="ai-stats">{aiSummary(h.ai)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
