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
      headers: { 'Content-Type': 'application/json', 'X-Ledger-Id': ledgerId() },
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
