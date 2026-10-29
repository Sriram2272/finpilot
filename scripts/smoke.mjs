// Live smoke test: node scripts/smoke.mjs https://your-app.workers.dev
const base = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const ledger = crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const h = { 'Content-Type': 'application/json', 'X-Ledger-Id': ledger, 'X-Today': today };
let failed = 0;
async function step(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.log(`  ✗ ${name}: ${err.message}`);
    }
}
const req = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: h, body: body && JSON.stringify(body) });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
};
const ok = (cond, msg) => {
    if (!cond) throw new Error(msg);
};
console.log(`Smoke testing ${base}`);
await step('UI loads', async () => ok((await req('GET', '/')).data.includes('<div id="root">'), 'no React root'));
await step('health: database connected', async () => ok((await req('GET', '/api/health')).data.db === 'connected', 'db not connected'));
let draft;
await step('extract a spoken expense', async () => {
    const r = await req('POST', '/api/extract', { note: 'Spent ₹450 on lunch at Barbeque Nation yesterday, paid by card', today });
    ok(r.status === 200 && r.data.canSave, `status ${r.status}`);
    draft = Object.fromEntries(Object.entries(r.data.fields).map(([k, f]) => [k, f.value]));
});
let id;
await step('save to ledger', async () => {
    const r = await req('POST', '/api/transactions', { draft, draftId: crypto.randomUUID(), today });
    ok(r.status === 201, `status ${r.status} ${JSON.stringify(r.data)}`);
    id = r.data.transaction.id;
});
await step('load demo data + dashboard summary', async () => {
    ok((await req('POST', '/api/demo', { today })).status === 201, 'demo failed');
    const s = await req('GET', `/api/summary?month=${today.slice(0, 7)}`);
    ok(s.data.insights.length > 0 && s.data.budgets.length > 0, 'empty summary');
});
await step('CSV export', async () => ok((await req('GET', '/api/export.csv')).data.startsWith('date,type'), 'bad csv'));
await step('clean up', async () => {
    ok((await req('DELETE', `/api/transactions/${id}`)).status === 200, 'delete failed');
    ok((await req('DELETE', '/api/ledger')).status === 200, 'reset failed');
});
console.log(failed ? `${failed} step(s) failed` : 'All smoke checks passed');
process.exit(failed ? 1 : 0);
