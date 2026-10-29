# FinPilot: Personal Finance Intelligence

Say or type what you spent ("Paid ₹450 for lunch at Barbeque Nation yesterday by card"). FinPilot turns the note into a structured transaction. You check the fields and confirm, then it is saved to your ledger and your monthly category total updates.

**Live app:** https://finpilot.crelvin-career.workers.dev

Project option 8 (FinPilot). The automation implemented is *"Convert a spoken expense into a structured transaction and save it to a ledger"*. Saving also *updates budget totals*.

## What's new (v2)

- **Cloudflare Workers + D1** replace Express + MongoDB. No more "Database offline": D1 is a managed SQLite database bound directly to the Worker, on the free tier.
- **One-click demo**: "Load demo data" fills this month and last with realistic entries and budget limits. Demo rows are tagged and "Clear demo" removes only them.
- **Dashboard**: spent / received / net tiles with month-over-month change, a daily spending chart (hover tooltips + table view), category bars with budget-limit markers, and auto-generated insights (pace, top category, over-budget warnings, savings rate).
- **Ledger**: month switcher, search, category and type filters, edit entries, CSV export (formula-injection safe).
- **Dark mode** (auto / light / dark).
- **Tests**: 30 unit + API integration tests run the real Worker routes and SQL against SQLite, plus a live smoke test and GitHub Actions CI.

## Flow

```
text / voice ─▶ POST /api/extract ─▶ redact sensitive data ─▶ Claude (structured output, JSON schema)
                                                              └─ fallback: offline rule-based parser
            ◀─ fields + status (ok / missing / invalid / assumed)  ◀─ Zod + business-rule validation
user reviews / fixes / confirms
            ─▶ POST /api/transactions ─▶ validate again ─▶ Cloudflare D1 (totals computed by SQL, never drift)
            ◀─ saved record + category total ─▶ dashboard + ledger refresh
```

## Run locally

```bash
npm run setup     # installs worker + client deps
npm test          # unit + API integration tests (no network needed)
npm run dev       # builds the UI, applies local D1 migrations, runs on http://localhost:8787
```

Optional AI: put `ANTHROPIC_API_KEY=...` in `.dev.vars` locally, or `npx wrangler secret put ANTHROPIC_API_KEY` in production.

## Deploy (Cloudflare free tier)

```bash
npx wrangler login
npx wrangler d1 create finpilot          # put the database_id into wrangler.jsonc
npm run deploy                           # build UI, migrate D1, deploy Worker
npm run smoke -- https://finpilot.<you>.workers.dev
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | DB status and active extraction engine |
| GET | `/api/meta` | Allowed categories, currencies, payment methods |
| POST | `/api/extract` | `{note, today}` → extracted draft + per-field validation (nothing saved) |
| POST | `/api/transactions` | Re-validates and saves the transaction |
| GET | `/api/transactions` | Ledger, filter with `month`, `q`, `category`, `type` |
| PATCH / DELETE | `/api/transactions/:id` | Edit (re-validated) / remove an entry |
| GET / PUT | `/api/budgets` | Monthly category totals / set or clear a limit |
| GET | `/api/summary?month=` | Totals, previous month, budgets, daily series, insights |
| GET | `/api/export.csv?month=` | CSV download |
| POST / DELETE | `/api/demo` | Load / clear demo data |
| DELETE | `/api/ledger` | Wipe this browser's ledger |

All ledger routes need an `X-Ledger-Id` header. The browser generates an anonymous UUID for it on first use.

Full project report: [docs/FinPilot_Project_Report.pdf](docs/FinPilot_Project_Report.pdf) (also [docs/report.html](docs/report.html)).
