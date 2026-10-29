import { useState } from 'react';
import { api, money, monthLabel, shortMoney } from '../api';

function pctChange(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

export function KpiStrip({ summary }) {
  const cur = summary.currency;
  const t = summary.totals[cur] || { spent: 0, received: 0, count: 0 };
  const p = summary.prevTotals[cur] || { spent: 0, received: 0 };
  const net = t.received - t.spent;
  const change = pctChange(t.spent, p.spent);
  const prev = monthLabel(summary.prevMonth, { month: 'short' });
  return (
    <section className="kpis" aria-label="Month totals">
      <div className="kpi">
        <span className="kpi-label">Spent</span>
        <span className="kpi-value">{money(t.spent, cur)}</span>
        <span className={`kpi-sub ${change == null ? '' : change > 0 ? 'neg' : 'pos'}`}>
          {change == null ? `No ${prev} data` : `${change > 0 ? '↑' : '↓'} ${Math.abs(change)}% vs ${prev}`}
        </span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Received</span>
        <span className="kpi-value">{money(t.received, cur)}</span>
        <span className="kpi-sub">{p.received ? `${money(p.received, cur)} in ${prev}` : '—'}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Net</span>
        <span className={`kpi-value ${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}`}>
          {net < 0 ? '−' : net > 0 ? '+' : ''}
          {money(Math.abs(net), cur)}
        </span>
        <span className="kpi-sub">{t.received > 0 ? `${Math.round((net / t.received) * 100)}% savings rate` : '—'}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Entries</span>
        <span className="kpi-value">{t.count || 0}</span>
        <span className="kpi-sub">{summary.budgets.filter((b) => b.limit != null && b.spent > b.limit).length || 'No'} budgets exceeded</span>
      </div>
    </section>
  );
}

export function Insights({ insights }) {
  return (
    <section className="panel">
      <h2 className="panel-title">Insights</h2>
      {insights.length === 0 ? (
        <p className="empty">Insights appear once you log a few entries.</p>
      ) : (
        <ul className="insights">
          {insights.map((i) => (
            <li key={i.text} className={`insight ${i.kind}`}>
              <span className="dot" aria-hidden="true" />
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Day-by-day spending for the month: one bar per day, hover for the exact value.
export function DailyChart({ summary }) {
  const [hover, setHover] = useState(null);
  const { month, currency, daily } = summary;
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const byDay = Object.fromEntries(daily.map((d) => [Number(d.date.slice(8, 10)), d.spent]));
  const max = Math.max(1, ...daily.map((d) => d.spent));
  const step = niceStep(max / 2);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  const W = 680;
  const H = 168;
  const pad = { l: 40, r: 4, t: 8, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const col = iw / days;
  const bw = Math.max(2, Math.min(14, col - 4)); // surface gap between bars
  const yOf = (v) => pad.t + ih - (v / top) * ih;
  const hovered = hover != null ? { day: hover, spent: byDay[hover] || 0 } : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Daily spending</h2>
        {daily.length > 0 && <span className="muted small">Peak {money(max, currency)}</span>}
      </div>
      {daily.length === 0 ? (
        <p className="empty">No spending recorded for {monthLabel(month, { month: 'long' })}.</p>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily spending in ${monthLabel(month)}, highest ${money(max, currency)}`}>
            {ticks.map((v) => (
              <g key={v}>
                <line className="grid" x1={pad.l} x2={W - pad.r} y1={yOf(v)} y2={yOf(v)} />
                <text className="axis" x={pad.l - 8} y={yOf(v)} dy="0.32em" textAnchor="end">
                  {shortMoney(v, currency)}
                </text>
              </g>
            ))}
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const v = byDay[d] || 0;
              const x = pad.l + (d - 1) * col + (col - bw) / 2;
              return (
                <g key={d} onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onBlur={() => setHover(null)} tabIndex={v ? 0 : -1}>
                  <rect className="hit" x={pad.l + (d - 1) * col} y={pad.t} width={col} height={ih} />
                  {v > 0 && <path className={`bar-mark ${hover === d ? 'on' : ''}`} d={roundedTop(x, yOf(v), bw, yOf(0) - yOf(v), Math.min(3, bw / 2))} />}
                  {(d === 1 || d % 5 === 0) && (
                    <text className="axis" x={pad.l + (d - 0.5) * col} y={H - 4} textAnchor="middle">
                      {d}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hovered && (
            <div className="tooltip" style={{ left: `${((pad.l + (hovered.day - 0.5) * col) / W) * 100}%` }}>
              <span>{new Date(y, m - 1, hovered.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <strong>{money(hovered.spent, currency)}</strong>
            </div>
          )}
        </div>
      )}
      {daily.length > 0 && (
        <details className="table-view">
          <summary>View as table</summary>
          <table>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{money(d.spent, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function BudgetRow({ b, max, month, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(b.limit ?? '');
  const [err, setErr] = useState('');
  const hasLimit = b.limit != null && b.limit > 0;
  const over = hasLimit && b.spent > b.limit;
  // With a limit the bar is progress against it; without one it is relative to the biggest category.
  const pct = hasLimit ? Math.min(100, (b.spent / b.limit) * 100) : max ? (b.spent / max) * 100 : 0;
  const tone = over ? 'over' : hasLimit && pct >= 80 ? 'near' : '';

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
    <li className={`budget ${tone}`}>
      <div className="budget-top">
        <span className="budget-name">{b.category}</span>
        <span className="budget-num">
          {money(b.spent, b.currency)}
          {hasLimit && <span className="muted"> / {money(b.limit, b.currency)}</span>}
        </span>
        <button className="row-action" onClick={() => setEditing((v) => !v)} aria-label={`Edit limit for ${b.category}`} title="Set monthly limit">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
          </svg>
        </button>
      </div>
      <div className="track" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.max(pct, b.spent > 0 ? 2 : 0)}%` }} />
      </div>
      {over && <p className="budget-note">Over by {money(b.spent - b.limit, b.currency)}</p>}
      {editing && (
        <form className="inline-form" onSubmit={save}>
          <input type="number" min="0" placeholder="Monthly limit" value={limit} onChange={(e) => setLimit(e.target.value)} autoFocus aria-label={`Monthly limit for ${b.category}`} />
          <button className="btn small primary">Save</button>
          {b.limit != null && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setLimit('');
                api('/budgets', { method: 'PUT', body: { month, category: b.category, currency: b.currency, limit: null } }).then(onChanged);
                setEditing(false);
              }}
            >
              Remove
            </button>
          )}
        </form>
      )}
      {err && <p className="hint error">{err}</p>}
    </li>
  );
}

export function Budgets({ summary, onChanged }) {
  const rows = summary.budgets;
  const max = Math.max(0, ...rows.map((b) => b.spent));
  const active = rows.filter((b) => b.spent > 0);
  const idle = rows.filter((b) => b.spent === 0);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Budgets</h2>
        <span className="muted small">{monthLabel(summary.month, { month: 'long' })}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">Category totals appear once you log an expense.</p>
      ) : (
        <ul className="budgets">
          {[...active, ...idle].map((b) => (
            <BudgetRow key={`${b.category}|${b.currency}|${b.limit}`} b={b} max={max} month={summary.month} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

// A bar with rounded top corners and a square base anchored on the baseline.
function roundedTop(x, y, w, h, r) {
  if (h <= r) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
