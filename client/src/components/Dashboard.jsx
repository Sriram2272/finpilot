import { useState } from 'react';
import { api, money, monthLabel, shortMoney } from '../api';

function pctChange(now, before) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

export function StatTiles({ summary }) {
  const cur = summary.currency;
  const t = summary.totals[cur] || { spent: 0, received: 0 };
  const p = summary.prevTotals[cur] || { spent: 0, received: 0 };
  const net = t.received - t.spent;
  const change = pctChange(t.spent, p.spent);
  return (
    <div className="tiles">
      <div className="tile">
        <span className="tile-label">Spent</span>
        <strong className="tile-value">{money(t.spent, cur)}</strong>
        {change != null && (
          <span className={`tile-delta ${change > 0 ? 'up' : 'down'}`}>
            {change > 0 ? '▲' : '▼'} {Math.abs(change)}% vs {monthLabel(summary.prevMonth, { month: 'short' })}
          </span>
        )}
      </div>
      <div className="tile">
        <span className="tile-label">Received</span>
        <strong className="tile-value pos">{money(t.received, cur)}</strong>
      </div>
      <div className="tile">
        <span className="tile-label">Net</span>
        <strong className={`tile-value ${net >= 0 ? 'pos' : 'neg'}`}>
          {net >= 0 ? '+' : '−'}
          {money(Math.abs(net), cur)}
        </strong>
        {t.received > 0 && <span className="tile-delta">{Math.round((net / t.received) * 100)}% saved</span>}
      </div>
    </div>
  );
}

export function Insights({ insights }) {
  if (!insights.length) return null;
  const icon = { good: '✓', warn: '!', info: 'i' };
  return (
    <ul className="insights" aria-label="Insights">
      {insights.map((i) => (
        <li key={i.text} className={`insight ${i.kind}`}>
          <span className="insight-icon" aria-hidden="true">
            {icon[i.kind]}
          </span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
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
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  const W = 640;
  const H = 200;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const col = iw / days;
  const bw = Math.max(2, col - 2); // 2px surface gap between bars
  const yOf = (v) => pad.t + ih - (v / top) * ih;

  const hovered = hover != null ? { day: hover, spent: byDay[hover] || 0 } : null;

  return (
    <figure className="chart">
      <figcaption>
        <h3>Daily spending</h3>
        <span className="muted small">{monthLabel(month)}</span>
      </figcaption>
      {daily.length === 0 ? (
        <p className="muted empty-chart">No spending recorded this month.</p>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily spending in ${monthLabel(month)}, highest ${money(max, currency)}`}>
            {ticks.map((v) => (
              <g key={v}>
                <line className="grid" x1={pad.l} x2={W - pad.r} y1={yOf(v)} y2={yOf(v)} />
                <text className="axis" x={pad.l - 6} y={yOf(v)} dy="0.32em" textAnchor="end">
                  {shortMoney(v, currency)}
                </text>
              </g>
            ))}
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const v = byDay[d] || 0;
              const x = pad.l + (d - 1) * col + (col - bw) / 2;
              return (
                <g key={d} onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onBlur={() => setHover(null)} tabIndex={v ? 0 : -1}>
                  {/* hit target is the whole column, not just the bar */}
                  <rect className="hit" x={pad.l + (d - 1) * col} y={pad.t} width={col} height={ih} />
                  {v > 0 && <path className={`bar-mark ${hover === d ? 'on' : ''}`} d={roundedTop(x, yOf(v), bw, yOf(0) - yOf(v), Math.min(4, bw / 2))} />}
                  {(d === 1 || d % 5 === 0) && (
                    <text className="axis" x={pad.l + (d - 0.5) * col} y={H - 6} textAnchor="middle">
                      {d}
                    </text>
                  )}
                </g>
              );
            })}
            {hovered && <line className="crosshair" x1={pad.l + (hovered.day - 0.5) * col} x2={pad.l + (hovered.day - 0.5) * col} y1={pad.t} y2={pad.t + ih} />}
          </svg>
          {hovered && (
            <div className="tooltip" style={{ left: `${((pad.l + (hovered.day - 0.5) * col) / W) * 100}%` }}>
              <span className="muted">{new Date(y, m - 1, hovered.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <strong>{money(hovered.spent, currency)}</strong>
            </div>
          )}
        </div>
      )}
      {daily.length > 0 && (
        <details className="table-view">
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Spent</th>
              </tr>
            </thead>
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
    </figure>
  );
}

function CategoryRow({ b, max, month, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(b.limit ?? '');
  const [err, setErr] = useState('');
  const over = b.limit != null && b.spent > b.limit;
  const scale = Math.max(max, b.limit || 0) || 1;

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
    <li className={`cat ${over ? 'over' : ''}`}>
      <div className="cat-top">
        <span className="cat-name">{b.category}</span>
        <span className="cat-num">
          {money(b.spent, b.currency)}
          {b.limit != null && <span className="muted"> / {money(b.limit, b.currency)}</span>}
        </span>
      </div>
      <div className="cat-track">
        <span className="cat-bar" style={{ width: `${(b.spent / scale) * 100}%` }} />
        {b.limit != null && <span className="cat-limit" style={{ left: `${Math.min(100, (b.limit / scale) * 100)}%` }} title={`Limit ${money(b.limit, b.currency)}`} />}
      </div>
      <div className="cat-foot">
        {over ? (
          <span className="over-msg">
            <span aria-hidden="true">⚠</span> Over by {money(b.spent - b.limit, b.currency)}
          </span>
        ) : (
          <span className="muted small">
            {b.count} {b.count === 1 ? 'entry' : 'entries'}
            {b.limit != null && b.limit > 0 && ` · ${money(b.limit - b.spent, b.currency)} left`}
          </span>
        )}
        {!editing && (
          <button className="link" onClick={() => setEditing(true)}>
            {b.limit != null ? 'Change limit' : 'Set limit'}
          </button>
        )}
      </div>
      {editing && (
        <form className="limit-form" onSubmit={save}>
          <input type="number" min="0" placeholder="Monthly limit (blank to clear)" value={limit} onChange={(e) => setLimit(e.target.value)} autoFocus aria-label={`Monthly limit for ${b.category}`} />
          <button className="btn tiny primary">Set</button>
          <button type="button" className="btn tiny" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      {err && <p className="hint error">{err}</p>}
    </li>
  );
}

export function CategoryChart({ summary, onChanged }) {
  const rows = summary.budgets;
  const max = Math.max(0, ...rows.map((b) => b.spent));
  return (
    <section className="chart">
      <div className="figcaption">
        <h3>Spending by category</h3>
        <span className="muted small">bar = spent · tick = limit</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted empty-chart">Categories appear here once you log an expense.</p>
      ) : (
        <ul className="cats">
          {rows.map((b) => (
            <CategoryRow key={`${b.category}|${b.currency}|${b.limit}`} b={b} max={max} month={summary.month} onChanged={onChanged} />
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
