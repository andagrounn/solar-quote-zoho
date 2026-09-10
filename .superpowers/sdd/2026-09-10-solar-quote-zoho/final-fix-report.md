# Final Fix Wave Report — solar-quote-zoho

**Date:** 2026-09-10  
**Branch:** feat/solar-quote-impl  
**Status:** DONE

## Fixes Applied

### FIX 1 — XSS hardening in `public/app.js`

Replaced `innerHTML` usage in the `createBtn` click handler with safe DOM construction:
- Success branch: `result.textContent` sets the estimate number text; a `<a>` element is created via `createElement` only when `data.url` starts with `https://`.
- Error branch: `result.textContent = ''` clears the container; a `<span class="error">` is constructed via `createElement` with `.textContent` assignment — no server/Zoho-derived HTML injected.

### FIX 2 — Remove dead code + correct misleading docs

- `server/calc.js` and `test/calc.test.js` removed via `git rm`. Verified no other file in `server/` or `test/` imports `calc` before deletion.
- `docs/superpowers/specs/2026-09-10-solar-quote-zoho-design.md`:
  - §4 data-flow: removed "server recomputes authoritatively" — replaced with "Zoho Books computes tax and totals authoritatively from the submitted line items and the configured GCT `tax_id`."
  - §4 step 4 header: removed "recomputes totals" from the server validation step.
  - §3 architecture tree: removed `calc.js` entry.
  - §9 testing: removed `calc.test.js` bullet (file no longer exists).
  - Test directory listing in tree: removed `calc.test.js` line.
- `README.md`: already stated "Zoho computes tax/totals authoritatively; the browser figures are display-only." No change needed to that line.

### FIX 3 — README env var completeness

Added two optional env vars to the `.env` setup list in `README.md`:
- `PORT` — optional, default 3000
- `ZOHO_CURRENCY` — optional, default USD; estimate inherits Zoho org/contact currency

## Test Results

```
Test Suites: 5 passed, 5 total
Tests:       24 passed, 24 total
Snapshots:   0 total
Time:        0.271 s, estimated 1 s
```

calc.test.js removed (expected); all remaining 5 suites green.

## Files Changed

- `public/app.js` — XSS fix
- `server/calc.js` — deleted
- `test/calc.test.js` — deleted
- `README.md` — added PORT + ZOHO_CURRENCY env vars
- `docs/superpowers/specs/2026-09-10-solar-quote-zoho-design.md` — removed false "server recomputes totals" claims, removed dead calc.js references
