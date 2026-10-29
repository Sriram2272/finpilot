// Thin wrapper around fetch that always returns { data } or throws an Error with a
// friendly message (and the server's error code/details when there are any).

function ledgerId() {
  const KEY = 'finpilot-ledger-id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private mode etc. — fall back to a per-tab id.
    window.__ledger ??= crypto.randomUUID();
    return window.__ledger;
  }
}

export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const newDraftId = () => crypto.randomUUID();

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Ledger-Id': ledgerId(), 'X-Today': localToday() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("Couldn't reach the server. Check your connection and try again."), { code: 'NETWORK' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status}).`);
    Object.assign(err, data?.error || {}, { status: res.status });
    throw err;
  }
  return data;
}

export function money(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function prettyDate(iso) {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const PAYMENT_LABELS = { cash: 'Cash', card: 'Card', upi: 'UPI', bank_transfer: 'Bank transfer', wallet: 'Wallet' };

// Fetches a file from the API (with the ledger header) and hands it to the browser as a download.
export async function download(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { 'X-Ledger-Id': ledgerId(), 'X-Today': localToday() } });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function monthLabel(month, opts = { month: 'long', year: 'numeric' }) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', opts);
}

export function shortMoney(amount, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

// Theme: 'system' | 'light' | 'dark', remembered per browser.
export function loadTheme() {
  try {
    return localStorage.getItem('finpilot-theme') || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('finpilot-theme', theme);
  } catch {
    /* private mode */
  }
}
