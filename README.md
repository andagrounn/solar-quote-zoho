# Solar Quote → Zoho Books

Web form for sales reps to create solar EPC quotations as **Draft Estimates**
in Zoho Books. Shared passcode; no per-rep logins; no database.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `QUOTE_PASSCODE` — shared team passcode
   - `SESSION_SECRET` — random string
   - `ZOHO_REGION` — `com` | `eu` | `in` | `com.au`
   - `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`
   - `ZOHO_ORG_ID` — Zoho Books organization id
   - `ZOHO_GCT_TAX_ID` — the `tax_id` of your 15% GCT tax in Zoho Books
   - `PORT` — *(optional, default 3000)* port the server listens on
   - `ZOHO_CURRENCY` — *(optional, default USD; informational)* the estimate inherits the Zoho org/contact currency
3. `npm start` → open `http://localhost:3000`

## Finding your GCT tax_id

Call `GET https://www.zohoapis.<region>/books/v3/settings/taxes?organization_id=<org>`
with a valid token and copy the `tax_id` of the 15% GCT entry.

## How it works

- Reps enter passcode → session cookie.
- Fill header, customer, freeform line items, terms.
- "Create in Zoho" finds-or-creates the contact and posts a Draft estimate.
- Zoho computes tax/totals authoritatively; the browser figures are display-only.

## Tests

`npm test` — money math, payload builder, Zoho client, contacts/estimates, routes.
All tests mock Zoho; no network or credentials required.
