# Fix & Full-Stack Integration Audit (Profiles, Top-ups, Dashboards, RLS, Local Dev)

This is the implementation checklist for the current project stack (Supabase + Paystack + Resend) without UI/UX changes.

## Scope

- Fix profile save + top-up reliability issues.
- Verify RLS safety and remove policy recursion paths.
- Ensure finance schema/migrations are present and queryable.
- Validate Admin, Sales, Developer, Client data paths.
- Provide localhost-first runbook and repeatable audit commands.

## Current project mapping

- Profile table: `public.profiles`
- Top-up table used by app: `public.wallet_topups`
- Compatibility surface: `public.top_ups` (view -> `wallet_topups`)
- Ledger: `public.financial_transactions`
- Webhook log table: `public.payment_webhook_events`

## P0 checks

- `npm run test:keys`
- `npm run audit:fullstack`
- `npm run force:test-users`

If any command fails, fix env/config before dashboard QA.

## Localhost flow (no deployment required)

1. `npm install`
2. `npm run test:keys`
3. `npm run audit:fullstack`
4. `npm run force:test-users`
5. `npm run dev`
6. Open `http://localhost:3000/landing_page.html`

## Database / migration checks

1. Apply migrations:
   - `supabase/migrations/20260224213000_finance_workflow_core.sql`
   - `supabase/migrations/20260224220000_payment_reconciliation.sql`
   - `supabase/migrations/20260226010000_client_admin_reliability_patch.sql`
   - `supabase/migrations/20260226020000_topups_compat_view.sql`
2. Run `supabase/audit_queries.sql`.
3. Confirm these objects exist:
   - `profiles`
   - `wallets`
   - `wallet_topups`
   - `top_ups`
   - `financial_transactions`
   - `payment_webhook_events`

## RLS / recursion checks

1. Confirm `public.current_role()` uses `security definer` and `row_security = off`.
2. Confirm profile policies are owner-scoped and do not call recursive profile lookups in `USING`/`WITH CHECK`.
3. Confirm no new policy/function for `profiles` performs recursive `profiles` reads under policy evaluation.

## Dashboard verification matrix

Run the same core checks for each role.

### Client

- Update profile -> DB row updates.
- Submit top-up -> `wallet_topups.status=pending`.
- Paystack callback -> top-up/invoice status moves to paid/success.
- Billing page updates.

### Sales

- Create/send invoice -> row in `invoices`, pending row in `financial_transactions`.
- Invoice state reflects in client and sales views.

### Developer

- Assigned project list loads.
- Earnings source loads from `financial_transactions` (fallback handled).

### Admin

- Can view users/projects/transactions/top-ups.
- No mojibake / no panel flicker / no broken counts.

## Integrations

- Paystack:
  - Signature verified in webhook.
  - Idempotent reconciliation behavior.
- Resend:
  - Invoice/send-email paths succeed.
- Supabase auth:
  - Role routing works for:
    - `client@test.com`
    - `admin@test.com`
    - `commissioner@test.com`
    - `developer@test.com`

## Observability

- Log and inspect webhook failures in `payment_webhook_events`.
- Track failed/held finance rows in `financial_transactions`.
- Capture browser network status for profile/top-up requests when debugging `Failed to fetch`.

## Deliverables already added in this repo

- `scripts/fullstack-audit.mjs`
- `supabase/audit_queries.sql`
- `dev-setup.sh`
- `dev-setup.ps1`
- `supabase/migrations/20260226020000_topups_compat_view.sql`

