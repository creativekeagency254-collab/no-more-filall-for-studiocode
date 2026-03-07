# Payments Setup (Paystack/M-Pesa + Reconciliation)

## 0) Security first
If any live keys were shared in chat, logs, or committed anywhere, rotate them immediately in:
- Paystack dashboard (`pk_live`, `sk_live`)
- Resend dashboard (`re_...`)
- Supabase project secrets

## 0.1) Localhost mode (recommended while stabilizing)
Run the app locally instead of Vercel:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000/landing_page.html
```

Local env files used:
- `.env`
- `.env.local`
- `supabase/.env.functions.local` (for `supabase functions serve`)

## 1) Apply database migrations
- `supabase/migrations/20260224213000_finance_workflow_core.sql`
- `supabase/migrations/20260224220000_payment_reconciliation.sql`
- `supabase/migrations/20260226010000_client_admin_reliability_patch.sql`

These create wallets, payment methods, topups, payout requests, transaction ledger, and reconciliation triggers.
The reliability patch also ensures `platform_settings`, admin visibility policies, and realtime channels are present.

## 1.1) Remove demo/test data (recommended before go-live)
Run:
- `supabase/cleanup_demo_data.sql`

This clears known demo accounts (`*@seed.escrowmkt.local`, `*@seed.codestudio.ke`, `*@example.com`, and standard `*@test.com` samples)
from operational tables so dashboards show only real records.

## 2) Keep secrets server-side only
Use Supabase Edge Function secrets (or backend env vars), not frontend files.

Recommended secrets:
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `RESEND_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 3) Webhook flow
Payment provider webhook should:
1. log into `payment_webhook_events`
2. update `invoices.status='paid'` or `wallet_topups.status='paid'`

Once status is updated:
- invoice trigger creates `invoice_payment` + `commission_accrual` records
- topup trigger credits `wallets.balance` and marks topup transaction paid

## 4) Sales commission
Sales invoice creation writes pending `financial_transactions` with `commission_amount` at 30%.
When invoice is paid, reconciliation trigger records paid amount and commission accrual.

## 5) Admin payout approvals
Sales payout requests are inserted into `payout_requests`.
Admin can approve/update status to `approved/paid` and corresponding ledger entries remain in `financial_transactions`.

## 6) Edge Functions used by dashboards
- `send-invoice` -> creates/updates Paystack payment link on `invoices` and sends invoice email via Resend
- `initiate-topup` -> client wallet top-up entry + Paystack checkout URL
- `paystack-webhook` -> verifies signature and settles invoice/top-up status
- `send-email` -> generic transactional email (sales/admin helper)
- `send_gmail` -> direct Gmail sender endpoint for testing/manual sends

Deploy:

```bash
supabase functions deploy send-invoice
supabase functions deploy initiate-topup
supabase functions deploy paystack-webhook
supabase functions deploy send-email
supabase functions deploy send_gmail
```

Required secrets:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set SUPABASE_ANON_KEY=...
supabase secrets set PAYSTACK_SECRET_KEY=...
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM_EMAIL="CODE STUDIO ke <billing@yourdomain.com>"
supabase secrets set GOOGLE_CLIENT_ID=...
supabase secrets set GOOGLE_CLIENT_SECRET=...
supabase secrets set GOOGLE_REFRESH_TOKEN=...
supabase secrets set GOOGLE_SENDER_EMAIL="creative.keagency254@gmail.com"
```

## 6.1) Gmail refresh-token reset flow

```bash
npm run gmail:refresh
# then paste code:
npm run gmail:refresh -- --code "<google-code>" --set-supabase --project-ref smdbfaomeghoejqqkplv --sender "creative.keagency254@gmail.com"
```

## 6.2) Track/sync Paystack amounts

Read-only tracking:

```bash
npm run paystack:track
```

Apply DB status sync from Paystack verify API:

```bash
npm run paystack:reconcile
```

Single reference:

```bash
node scripts/reconcile-paystack.mjs --reference "<paystack_reference>"
```

## 7) Role routing sanity check (same login form, different dashboards)
After users sign in, routing is based on `profiles.role`.
Verify role distribution:

```sql
select role, count(*) from public.profiles group by role order by role;
```

Set/repair role mappings:

```sql
update public.profiles set role = 'client' where lower(email) = 'client@test.com';
update public.profiles set role = 'admin' where lower(email) = 'admin@test.com';
update public.profiles set role = 'commissioner' where lower(email) = 'commissioner@test.com';
update public.profiles set role = 'developer' where lower(email) = 'developer@test.com';
```

Or force-create/update the four test users with one command:

```bash
npm run force:test-users
```

