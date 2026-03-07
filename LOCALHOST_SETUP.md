# Localhost Setup (No Vercel Needed)

This project can run fully on localhost with your current Supabase, Paystack, and Gmail/Resend email setup.

## 1) Keys and env files

Already configured:

- `.env`
- `.env.local`
- `supabase/.env.functions.local` (copy of `.env.local` for local function serving)

All three are set to:

```txt
APP_URL=http://localhost:3000
```

## 2) Start frontend locally

From `project/`:

```bash
npm install
npm run dev
```

Open:

```txt
http://localhost:3000/landing_page.html
```

## 3) One-command retry setup (recommended)

If you want an automatic retry flow that checks keys/audit/users and still starts localhost even when audit fails:

Windows:

```powershell
.\dev-setup.ps1
```

macOS/Linux:

```bash
./dev-setup.sh
```

## 3.1) Reset core test logins + roles

```bash
npm run force:test-users
npm run verify:test-logins
```

This ensures these accounts exist and route correctly by role:
- `client@test.com`
- `admin@test.com`
- `commissioner@test.com`
- `developer@test.com`

## 3.2) Paystack amount tracking / reconciliation

Read-only tracking:

```bash
npm run paystack:track
```

Apply status sync (marks invoice/top-up paid/failed from Paystack verify API):

```bash
npm run paystack:reconcile
```

Track one reference only:

```bash
node scripts/reconcile-paystack.mjs --reference "<paystack_reference>"
```

## 4) If audit fails with missing finance tables

If you see errors like:

- `Could not find the table 'public.wallet_topups' in the schema cache`
- `Could not find the table 'public.payment_methods' in the schema cache`

Run these SQL files in Supabase SQL Editor (in order):

1. `supabase/migrations/20260224213000_finance_workflow_core.sql`
2. `supabase/migrations/20260224220000_payment_reconciliation.sql`
3. `supabase/migrations/20260226010000_client_admin_reliability_patch.sql`
4. `supabase/migrations/20260226020000_topups_compat_view.sql`
5. `supabase/migrations/20260226123000_financial_transaction_traceability.sql`

Then rerun:

```bash
npm run audit:fullstack
```

## 4.1) Client payment activity tracking (auto)

The client billing page now includes **Payment Activity** with:

- transaction type
- amount/currency
- status
- from/to account labels
- references (Paystack or internal transaction refs)

The migration `20260226123000_financial_transaction_traceability.sql` enables automatic payer/payee/account backfilling for finance records.

## 5) Optional: run edge functions locally

If you want to test function code locally before deploying:

```bash
npx --yes supabase@2.76.15 functions serve --env-file supabase/.env.functions.local
```

Functions will be available at:

```txt
http://127.0.0.1:54321/functions/v1/<function-name>
```

For admin live revenue/paystack tracking, deploy this function too:

```bash
npx --yes supabase@2.76.15 functions deploy get-paystack-balance --project-ref smdbfaomeghoejqqkplv
```

## 6) Supabase Auth settings for localhost

In Supabase Dashboard -> Authentication -> URL Configuration:

- `Site URL`: `http://localhost:3000`
- Add Redirect URLs:
  - `http://localhost:3000`
  - `http://localhost:3000/landing_page.html`

For Google OAuth, keep provider callback as your Supabase URL callback:

```txt
https://<your-project-ref>.supabase.co/auth/v1/callback
```

## 7) Paystack webhook for live keys

For live keys, keep Paystack webhook pointing to hosted Supabase function (not localhost):

```txt
https://<your-project-ref>.supabase.co/functions/v1/paystack-webhook
```

Localhost cannot receive Paystack live webhooks directly unless tunneled.

## 7.1) Paystack-managed invoice emails (recommended)

The `send-invoice` function now supports Paystack customer records + payment requests:

- Creates/uses Paystack customer by email.
- Creates Paystack payment request with `send_notification=true`.
- Returns dashboard payment link (checkout URL) and keeps Supabase invoice status synced.

Optional secret toggle (defaults to enabled):

```bash
npx supabase secrets set PAYSTACK_USE_PAYMENT_REQUEST=true --project-ref smdbfaomeghoejqqkplv
```

If you want to resend invoice to a different email and force a fresh Paystack request, call `send-invoice` with:

```json
{ "force_new_request": true }
```

## 8) Quick local smoke test

1. Open `http://localhost:3000/landing_page.html`
2. Sign in with one test account per role:
   - `client@test.com`
   - `admin@test.com`
   - `commissioner@test.com`
   - `developer@test.com`
3. Confirm each account routes to its own dashboard.

## 8.1) Lifecycle simulation status (copy/paste)

Use this exact block:

```txt
Lifecycle simulation now passes 27/28 steps.
Report: SIMULATION_LIFECYCLE_REPORT.md
JSON: SIMULATION_LIFECYCLE_RESULT.json
```

Full artifact paths:
- `project/SIMULATION_LIFECYCLE_REPORT.md`
- `project/SIMULATION_LIFECYCLE_RESULT.json`

## 9) Common issues

- `Acquiring an exclusive Navigator LockManager lock "...auth-token" timed out`:
  1. Close extra tabs of the same app.
  2. Clear site data for `localhost:3000`.
  3. Restart localhost and sign in again.
  4. This project now initializes Supabase auth with a non-blocking lock strategy in `supabase-client.js`.

- Gmail invoice send fails with `invalid_grant` or mail falls back to Resend:
  1. Generate and set a fresh Google refresh token:
     - `npm run gmail:refresh`
     - `npm run gmail:refresh -- --code "<google-code>" --set-supabase --project-ref smdbfaomeghoejqqkplv --sender "creative.keagency254@gmail.com"`
  2. Ensure Supabase function secrets are set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SENDER_EMAIL`.
  3. Force Gmail-only send by setting `ALLOW_RESEND_FALLBACK=false`.
  4. Redeploy functions after updating secrets:
     - `npx --yes supabase@2.76.15 functions deploy send-invoice --project-ref smdbfaomeghoejqqkplv`
     - `npx --yes supabase@2.76.15 functions deploy send-email --project-ref smdbfaomeghoejqqkplv`

- Gmail send returns `unauthorized_client` or `Error: Unauthorized`:
  1. In Google Cloud, confirm **Gmail API is enabled** for the same project as your OAuth client.
  2. Regenerate refresh token using the **same** `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` and scope `https://www.googleapis.com/auth/gmail.send`.
  3. Ensure the OAuth app user (`creative.keagency254@gmail.com`) is allowed (test user if app is in testing mode).
  4. Set the new refresh token and redeploy functions:
     - `npx supabase secrets set GOOGLE_REFRESH_TOKEN="<new-refresh-token>" --project-ref smdbfaomeghoejqqkplv`
     - `npx --yes supabase@2.76.15 functions deploy send-email --project-ref smdbfaomeghoejqqkplv`
     - `npx --yes supabase@2.76.15 functions deploy send-invoice --project-ref smdbfaomeghoejqqkplv`
     - `npx --yes supabase@2.76.15 functions deploy send_gmail --project-ref smdbfaomeghoejqqkplv`

- `send-invoice` returns `401` while generating payment link in client dashboard:
  1. This repo now sets `[functions.send-invoice] verify_jwt = false` in `supabase/config.toml` to avoid auth-gateway failures on hosted dashboards.
  2. Redeploy the function so the auth setting takes effect:
     - `npx --yes supabase@2.76.15 functions deploy send-invoice --project-ref smdbfaomeghoejqqkplv`
  3. Re-test from client billing:
     - Click `Generate Link` on invoice.
     - It should redirect directly to Paystack checkout and email the invoice to the logged-in client email.
