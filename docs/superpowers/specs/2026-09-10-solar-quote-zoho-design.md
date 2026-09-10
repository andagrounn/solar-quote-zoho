# Solar Quote → Zoho Books — Design Spec

**Date:** 2026-09-10
**Status:** Approved for planning
**Location:** `/WEB/solar-quote-zoho`

## 1. Purpose

Give sales representatives — who do **not** hold paid Zoho Books logins — a
simple branded web form to build solar EPC quotations that are created as real
**Estimates** inside Zoho Books via the Zoho Books API. The form mirrors the
company's existing solar quotation layout (see reference sample) so reps enter
data in a familiar structure, and the resulting record lives in Zoho as the
single source of truth.

## 2. Scope

### In scope (v1)
- Single-page web form matching the reference quotation layout.
- Freeform line-item table (reps add/remove every row).
- Auto-computed Sub Total, GCT (15%), and Total (USD).
- Shared-passcode gate for the sales team.
- Thin backend that holds Zoho secrets server-side and proxies to Zoho.
- Find-or-create Zoho **contact** from entered customer details.
- Create Zoho **Estimate** as a **Draft** (manager reviews before sending).
- GCT 15% applied via a configured Zoho `tax_id`.
- Header fields (Quotation #, Inquiry #, Date, Subject) and footer terms
  (Price Term, Delivery, Terms of Payment, Warranty, Offer validity).
- Unit tests for math + payload builder; mocked Zoho client test.

### Out of scope (v1 — deferred, not rejected)
- Custom PDF generation (rely on Zoho's estimate PDF/template).
- Per-rep login accounts / attribution (shared passcode only).
- Pulling items from a Zoho price list (line items are freeform).
- Auto-sending estimates to customers (created as Draft only).
- Persisting quotes locally / any database.

## 3. Architecture

One small Node/Express application, single deployable:

```
solar-quote-zoho/
  server/
    index.js            # Express app: static serving + API routes
    auth.js             # passcode check + signed session cookie
    zoho/
      client.js         # OAuth token cache/refresh + HTTP wrapper
      contacts.js       # find-or-create contact
      estimates.js      # create estimate
      payload.js        # PURE: build Zoho estimate payload from form data
    calc.js             # PURE: line totals, subtotal, GCT, grand total
  public/
    index.html          # the sales-rep quotation form
    app.js              # form logic, row add/remove, live totals
    styles.css          # branded layout mirroring the sample
  test/
    calc.test.js
    payload.test.js
    estimates.test.js   # mocked Zoho client
  .env.example
  package.json
  README.md
```

**Why a backend at all:** the Zoho client secret and refresh token must never
reach the browser. The backend is the trust boundary — it authenticates the
rep (passcode) and is the only place Zoho credentials exist.

## 4. Data Flow

1. Rep opens the app → enters passcode → `POST /api/login` sets a signed,
   httpOnly session cookie.
2. Rep fills header, customer block, line items, terms. `app.js` computes row
   totals, subtotal, GCT (15%), and grand total live in the browser (display
   only — server recomputes authoritatively).
3. Rep clicks **Create in Zoho** → `POST /api/quote` with the full form JSON.
4. Server validates required fields, recomputes totals, then:
   a. `contacts.js` searches Zoho for the customer (by email, else name); if
      absent, creates a contact.
   b. `payload.js` builds the estimate payload (line items, GCT `tax_id`,
      subject, terms → notes, reference number = Inquiry #).
   c. `estimates.js` `POST`s the estimate as Draft.
5. Server returns the Zoho estimate id + deep link; frontend shows success with
   a link to open it in Zoho.

## 5. API Contract

### `POST /api/login`
- Body: `{ passcode: string }`
- 200 → sets `session` cookie; `{ ok: true }`
- 401 → `{ error: "Invalid passcode" }`

### `POST /api/quote` (auth-gated)
- Body:
  ```json
  {
    "quotationNo": "string",
    "inquiryNo": "string",
    "date": "YYYY-MM-DD",
    "subject": "string",
    "customer": { "name": "string", "email": "string?", "phone": "string?" },
    "lineItems": [
      { "goodsType": "string", "description": "string", "unit": "string",
        "quantity": number, "unitPrice": number, "remark": "string?" }
    ],
    "terms": {
      "priceTerm": "string", "delivery": "string", "payment": "string",
      "warranty": "string", "validity": "string"
    }
  }
  ```
- 200 → `{ ok: true, estimateId, estimateNumber, url }`
- 400 → `{ error, details }` (validation)
- 401 → not authenticated
- 502 → `{ error: "Zoho rejected the request", details }` (verbatim Zoho error)

### `GET /api/health`
- 200 → `{ ok: true }`

## 6. Zoho Integration

- **OAuth2:** server exchanges refresh token → access token at
  `https://accounts.zoho.<region>/oauth/v2/token`; token cached in memory until
  ~5 min before expiry, then auto-refreshed. Region derived from config
  (`.com` / `.eu` / `.in` / `.com.au`).
- **Base URL:** `https://www.zohoapis.<region>/books/v3`.
- **Org:** `organization_id` query param on every call.
- **Contact:** `GET /contacts?email=` (fallback `?contact_name=`) →
  `POST /contacts` if not found. Store returned `contact_id`.
- **Estimate:** `POST /estimates` with `customer_id`, `reference_number`
  (Inquiry #), `estimate_number` (Quotation #, if provided else Zoho
  auto-numbers), `date`, `subject`, `notes` (assembled from terms),
  `line_items[]` each `{ name: goodsType, description, rate: unitPrice,
  quantity, unit, tax_id: GCT_TAX_ID }`, currency USD. Created with default
  Draft status (no send).
- **GCT 15%:** referenced by `GCT_TAX_ID` from config so Zoho computes tax and
  totals authoritatively; the browser's GCT figure is display-only.

## 7. Configuration (`.env`, server-side only)

```
PORT=3000
SESSION_SECRET=<random>
QUOTE_PASSCODE=<shared team passcode>

ZOHO_REGION=com            # com | eu | in | com.au
ZOHO_CLIENT_ID=<...>
ZOHO_CLIENT_SECRET=<...>
ZOHO_REFRESH_TOKEN=<...>
ZOHO_ORG_ID=<...>
ZOHO_GCT_TAX_ID=<...>      # tax_id of the 15% GCT tax in Zoho Books
ZOHO_CURRENCY=USD
```

`.env.example` ships with these keys and no values. Real `.env` is gitignored.

## 8. Error Handling

- **Bad passcode** → 401, inline message on the login screen.
- **Missing/invalid fields** → 400 with a per-field `details` map; frontend
  highlights offending fields.
- **Expired/invalid Zoho token** → server attempts one refresh; on failure,
  502 with a clear "Zoho authentication failed — check credentials" message.
- **Zoho API rejection** → 502, Zoho's error surfaced verbatim in `details` for
  debugging.
- **Network/timeout to Zoho** → 502 with a retry hint.

## 9. Testing

- `calc.test.js` — row totals, subtotal, GCT 15%, grand total; rounding edge
  cases; empty/zero rows.
- `payload.test.js` — form JSON → Zoho estimate payload mapping, including
  tax_id attachment, notes assembly from terms, reference/estimate numbers.
- `estimates.test.js` — create-quote flow with a **mocked** Zoho client:
  contact-found path, contact-created path, Zoho-error path. No live API calls.

## 10. Security Notes

- Client secret + refresh token exist only in server `.env`; never sent to the
  browser or logged.
- Session cookie is `httpOnly`, `SameSite=Lax`, signed with `SESSION_SECRET`.
- Passcode compared with a constant-time comparison.
- All `/api/quote` requests require a valid session.

## 11. Open Config Items (user provides at setup)

- The `ZOHO_GCT_TAX_ID` for the 15% GCT tax in their Zoho Books org.
- Confirmation of Zoho data-center region.
- The shared team passcode value.
