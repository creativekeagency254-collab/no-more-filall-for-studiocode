# Supabase Edge Functions

This folder contains the payment and email functions used by dashboards.

## Functions
- `send-invoice`: Creates/refreshes Paystack payment link for an invoice and sends invoice email (Google Gmail API first, Resend fallback).
- `initiate-topup`: Creates wallet top-up and returns Paystack checkout URL for clients.
- `paystack-webhook`: Verifies Paystack signature and marks invoice/top-up paid or failed.
- `send-email`: Generic transactional email endpoint (Google Gmail API first, Resend fallback), also used by first-login client welcome email flow.
- `send_gmail`: Direct Gmail sender function using OAuth2 secrets (for manual/testing flows).

## Required secrets
Set these in Supabase (never in frontend files):

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set SUPABASE_ANON_KEY=...
supabase secrets set PAYSTACK_SECRET_KEY=...

# Gmail API (recommended primary sender)
supabase secrets set GOOGLE_CLIENT_ID=...
supabase secrets set GOOGLE_CLIENT_SECRET=...
supabase secrets set GOOGLE_REFRESH_TOKEN=...
supabase secrets set GOOGLE_SENDER_EMAIL=creative.keagency254@gmail.com
supabase secrets set ALLOW_RESEND_FALLBACK=false

# Optional Resend fallback
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM_EMAIL="CODE STUDIO ke <billing@yourdomain.com>"
```

## Deploy
```bash
supabase functions deploy send-invoice
supabase functions deploy initiate-topup
supabase functions deploy paystack-webhook
supabase functions deploy send-email
supabase functions deploy send_gmail
```

## Test `send_gmail`
```bash
curl -X POST "https://smdbfaomeghoejqqkplv.supabase.co/functions/v1/send_gmail" \
  -H "Content-Type: application/json" \
  -d '{"to":"creative.keagency254@gmail.com","subject":"Hello from Supabase","text":"This is a test email"}'
```

## Serve locally (optional)
```bash
supabase functions serve --env-file supabase/.env.functions.local
```

## Paystack webhook URL
Set this in Paystack Dashboard:

`https://smdbfaomeghoejqqkplv.supabase.co/functions/v1/paystack-webhook`
