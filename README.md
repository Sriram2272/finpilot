# FinPilot: Personal Finance Intelligence

Say or type what you spent ("Paid ₹450 for lunch at Barbeque Nation yesterday by card"). FinPilot turns the note into a structured transaction. You check the fields and confirm, then it is saved to your ledger and your monthly category total updates.

**Live app:** https://finpilot.bytexl.live

Project option 8 (FinPilot). The automation implemented is *"Convert a spoken expense into a structured transaction and save it to a ledger"*. Saving also *updates budget totals*.

## Flow

```
text / voice ─▶ POST /api/extract ─▶ redact sensitive data ─▶ Claude (structured output, JSON schema)
                                                              └─ fallback: offline rule-based parser
            ◀─ fields + status (ok / missing / invalid / assumed)  ◀─ Zod + business-rule validation
user reviews / fixes / confirms
            ─▶ POST /api/transactions ─▶ validate again ─▶ MongoDB: create Transaction + $inc Budget
            ◀─ saved record + new category total ─▶ confirmation card + ledger refresh
```

## Run locally

```bash
npm run setup          # installs server + client deps
cp .env.example .env   # set MONGO_DB_URI (and optionally ANTHROPIC_API_KEY)
npm run dev            # API on :5000, UI on :5173
npm test               # unit tests (validation, redaction, parser)
```

Production: `npm run build && npm start` serves the API and the built UI from one port.

## Deploy

- **Render:** push to GitHub, then New + → Blueprint. `render.yaml` sets everything up. Add `MONGO_DB_URI` (MongoDB Atlas free tier) and `ANTHROPIC_API_KEY`.
- **Docker:** `docker build -t finpilot . && docker run -p 5000:5000 --env-file .env finpilot`

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | DB status and active extraction engine |
| GET | `/api/meta` | Allowed categories, currencies, payment methods |
| POST | `/api/extract` | `{note, today}` → extracted draft + per-field validation (nothing saved) |
| POST | `/api/transactions` | Re-validates and creates the transaction, then updates the budget total |
| GET | `/api/transactions` | Ledger for this browser |
| DELETE | `/api/transactions/:id` | Removes an entry and reverses its budget total |
| GET / PUT | `/api/budgets` | Monthly category totals / set a monthly limit |

All ledger routes need an `X-Ledger-Id` header. The browser generates an anonymous UUID for it on first use.

Full project report: [docs/FinPilot_Project_Report.pdf](docs/FinPilot_Project_Report.pdf) (also [docs/report.html](docs/report.html)).
