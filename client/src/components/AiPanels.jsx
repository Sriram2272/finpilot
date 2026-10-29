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

const SUGGESTIONS = [
  ['📊', 'Where did most of my money go?'],
  ['🎯', 'Am I on track with my budgets?'],
  ['📅', 'How does this month compare to last month?'],
  ['✂️', 'Any subscriptions I could cut?'],
];

// Renders the small subset of markdown the assistant uses (**bold**, *italic*, "- " and "1. " lists)
// as React elements, so nothing from the model is ever injected as HTML.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function RichText({ text }) {
  const blocks = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    const kind = bullet ? 'ul' : numbered ? 'ol' : 'p';
    const body = bullet?.[1] ?? numbered?.[1] ?? line.replace(/^#+\s*/, '');
    const last = blocks[blocks.length - 1];
    if (kind !== 'p' && last?.kind === kind) last.items.push(body);
    else blocks.push({ kind, items: [body] });
  }
  return (
    <div className="rich">
      {blocks.map((b, i) => {
        if (b.kind === 'p') return <p key={i}>{inline(b.items[0])}</p>;
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="msg-action"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\*\*/g, ''));
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// Ask a question about this month's ledger, answered by Claude from the user's own data.
export function AskPanel({ month, ai, available, hasData }) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const busy = pending != null;

  useEffect(() => {
    if (history.length || pending) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [history, pending]);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setPending(text);
    setQuestion('');
    setError('');
    try {
      const res = await api('/ask', { method: 'POST', body: { question: text, month, ai } });
      setHistory((h) => [...h, { q: text, ...res }].slice(-6));
    } catch (err) {
      setError(err.message);
      setQuestion(text);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="card ask">
      <header className="ask-head">
        <span className="ask-icon" aria-hidden="true">
          ✦
        </span>
        <div>
          <h2>Ask FinPilot</h2>
          <p className="muted small">Questions about {monthName(month)}. Answers come only from your own ledger.</p>
        </div>
        {history.length > 0 && (
          <button className="link quiet ask-clear" onClick={() => setHistory([])}>
            Clear chat
          </button>
        )}
      </header>

      {!available ? (
        <p className="muted ask-empty">Ask questions about your spending once Claude is enabled on the server.</p>
      ) : (
        <>
          {history.length === 0 && !busy && (
            <div className="ask-start">
              <p className="muted small">{hasData ? 'Try one of these:' : 'Log a few entries or load the demo, then try:'}</p>
              <div className="ask-suggestions">
                {SUGGESTIONS.map(([icon, s]) => (
                  <button type="button" key={s} className="suggestion" onClick={() => ask(s)}>
                    <span aria-hidden="true">{icon}</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(history.length > 0 || busy) && (
            <ol className="thread" aria-live="polite">
              {history.map((h, i) => (
                <li key={`${h.q}-${i}`} className="turn">
                  <div className="msg user">{h.q}</div>
                  <div className="msg bot">
                    <span className="bot-avatar" aria-hidden="true">
                      F
                    </span>
                    <div className="bot-body">
                      <RichText text={h.answer} />
                      <div className="msg-foot">
                        <span className="model-chip">{h.ai.label.replace('Claude ', '')}</span>
                        <span>
                          {h.ai.effort} · {(h.ai.ms / 1000).toFixed(1)}s · {h.ai.inputTokens + h.ai.outputTokens} tokens
                        </span>
                        <CopyButton text={h.answer} />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {busy && (
                <li className="turn">
                  <div className="msg user">{pending}</div>
                  <div className="msg bot">
                    <span className="bot-avatar" aria-hidden="true">
                      F
                    </span>
                    <div className="bot-body typing" aria-label="FinPilot is thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </li>
              )}
              <li ref={endRef} aria-hidden="true" />
            </ol>
          )}

          {error && <p className="hint error">{error}</p>}

          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              placeholder={history.length ? 'Ask a follow-up…' : 'Ask anything, e.g. How much did I spend on food?'}
              aria-label="Ask a question about your spending"
              disabled={busy}
            />
            <button className="ask-send" disabled={busy || !question.trim()} aria-label="Send question">
              {busy ? '…' : '➤'}
            </button>
          </form>
          {history.length > 0 && !busy && (
            <div className="ask-more">
              {SUGGESTIONS.filter(([, s]) => !history.some((h) => h.q === s)).map(([icon, s]) => (
                <button type="button" key={s} className="chip" onClick={() => ask(s)}>
                  {icon} {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const monthName = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
