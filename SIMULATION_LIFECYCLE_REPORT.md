# Simulation Lifecycle Report

- Scenario: `SIM-1772110552106`
- Started: 2026-02-26T12:55:52.106Z
- Ended: 2026-02-26T12:56:07.145Z
- Steps: 28 (pass=27, fail=1)

## Roles Used
- Client: client@test.com
- Commissioner: commissioner@test.com
- Developer: developer@test.com
- Admin: admin@test.com

## Key Entity IDs
- Project: e419c510-9874-4f77-8f19-7dcafcc34e8e
- Deposit Invoice: 55a0596e-2790-4a58-ab39-2540b66a13d9
- Proposal: 1f208ca8-0a59-439b-8afb-b8461a1ccde6
- Dispute: e3a3ea2a-fe92-4161-a91f-c9eb22fedf2c
- Final Invoice: 81f2768c-1bff-408b-b720-99f45ad8d0be

## Payment Links Generated
- deposit_payment_link: https://checkout.paystack.com/rpqnv69lipe8q30
- final_payment_link: https://checkout.paystack.com/p6nltiwf1glp37n
- target_payment_link: https://checkout.paystack.com/yx41n0il6l6s0ox

## Step Results
1. [PASS] login:client - client@test.com authenticated
2. [PASS] login:admin - admin@test.com authenticated
3. [PASS] login:commissioner - commissioner@test.com authenticated
4. [PASS] login:developer - developer@test.com authenticated
5. [PASS] client:create_project - Project created: e419c510-9874-4f77-8f19-7dcafcc34e8e
6. [PASS] finance:create_deposit_invoice - Invoice 55a0596e-2790-4a58-ab39-2540b66a13d9 amount KSh 81,000
7. [PASS] finance:generate_deposit_payment_link - Link generated
8. [PASS] finance:simulate_deposit_paid - Invoice marked paid
9. [PASS] finance:record_deposit_transaction - Transaction recorded
10. [PASS] developer:submit_proposal - Proposal 1f208ca8-0a59-439b-8afb-b8461a1ccde6 created
11. [PASS] commissioner:assign_developer - Project moved to in-progress
12. [PASS] commissioner:accept_proposal - Proposal accepted
13. [PASS] project:create_milestones - Milestone creation path succeeded
14. [PASS] developer:submit_milestone - Milestone 5a6cada8-c7a0-4ce0-bfde-bdf62332ba58 submitted
15. [PASS] client:approve_milestone - Milestone approved/paid
16. [PASS] finance:record_milestone_release - Milestone payment recorded
17. [PASS] conflict:create_dispute - Dispute e3a3ea2a-fe92-4161-a91f-c9eb22fedf2c created
18. [PASS] admin:resolve_dispute - Resolved as refund
19. [PASS] finance:record_dispute_outcome - Dispute transaction recorded
20. [PASS] commissioner:request_payout - Payout 2fe5f2c9-8501-497f-95ef-069481af25d8
21. [PASS] developer:request_payout - Payout caba48fc-d8a1-4cfd-8764-09a44d38c917
22. [PASS] admin:approve_and_pay_payout:2fe5f2c9 - payout=200 tx=200
23. [PASS] admin:approve_and_pay_payout:caba48fc - payout=200 tx=200
24. [PASS] finance:generate_final_payment_link - Final payment link generated
25. [PASS] finance:simulate_final_invoice_paid - Final invoice marked paid
26. [PASS] realtime:insert_client_notification - Notification inserted for realtime test
27. [FAIL] email:send_report_to_target - status=200, email={"sent":false,"skipped":false,"provider":"gmail","error":"Error: Token has been expired or revoked."}
28. [PASS] email:send_payment_link_to_target - status=200, auth_url=present, email={"sent":true,"skipped":false,"provider":"paystack","note":"Payment request notification sent by Paystack"}

## Conflict Simulation
- Random conflict outcome selected: refund
- Dispute lifecycle simulated: create -> resolve -> finance record

## Realtime / No-Reload Note
- Notification row inserted for client realtime channel validation.
- Verify in browser that client notification badge increments without page reload.

## Email Dispatch Attempt
- Target recipient: mikomike200@gmail.com
- Result: status=200, ok=true

## Summary
1 step(s) failed. See Step Results for exact failure points.
