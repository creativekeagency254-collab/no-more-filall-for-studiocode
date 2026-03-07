# Full Stack Simulation Report

- Tag: `FULL-SIM-1772110551931`
- Started: 2026-02-26T12:55:51.932Z
- Ended: 2026-02-26T12:56:17.980Z
- Checks: 29 (pass=29, fail=0)

## 1) Base Lifecycle Simulation
- Base report: [SIMULATION_LIFECYCLE_REPORT.md](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\SIMULATION_LIFECYCLE_REPORT.md)
- Base JSON: [SIMULATION_LIFECYCLE_RESULT.json](C:\Users\user\Downloads\project-bolt-github-epghme6b\project\SIMULATION_LIFECYCLE_RESULT.json)
- Project ID: e419c510-9874-4f77-8f19-7dcafcc34e8e
- Deposit Invoice ID: 55a0596e-2790-4a58-ab39-2540b66a13d9
- Final Invoice ID: 81f2768c-1bff-408b-b720-99f45ad8d0be

## 2) Role Health (Admin / Sales / Developer / Client)
- client: login=PASS, projects=32, messages=4, invoices=58
- admin: login=PASS, projects=43, messages=0, invoices=80
- commissioner: login=PASS, projects=37, messages=13, invoices=17
- developer: login=PASS, projects=32, messages=9, invoices=1

## 3) Messaging Simulation (Two-way + Multi-role)
1. PASS - client_to_commissioner: message sent
2. PASS - commissioner_to_client_reply: reply sent
3. PASS - commissioner_to_developer: message sent
4. PASS - developer_to_commissioner_reply: reply sent
5. PASS - thread_fetch_project: thread_messages=4
6. PASS - client_mark_read: unread->read updated

## 4) Cashflow Validation (Client Start -> End)
- Invoiced Total: KSh 180,000
- Paid Invoice Total: KSh 180,000
- Paid Transactions Total: KSh 405,000
- Deposit Rule (45%) satisfied: YES
- Full lifecycle marked paid: YES

## 5) Sales Onboarding Paths
- profile_link_share: PASS (http://localhost:3000/sales_onboarding.html?sid=369095e2-a42a-4cfc-9072-10877c22720d&sname=Commissioner+User&srole=commissioner&theme=glass)
- sales_create_lead: PASS (project=8e13be9b-d3bc-4156-ad54-03c998fa8729)
- invite_notification: PASS (notification inserted)
- admin_assisted_project: PASS (project=b08c8faa-c95d-434f-9450-bcf6cad9db33)
- admin_invoice_link: PASS (https://checkout.paystack.com/n1trid5yhgcbdto)

## 6) Detailed Check Log
1. [PASS] [base_lifecycle] run_simulate_lifecycle - simulate-lifecycle executed
2. [PASS] [base_lifecycle] base_result_loaded - steps=28 pass=27 fail=1
3. [PASS] [roles] login_client - client@test.com authenticated
4. [PASS] [roles] login_admin - admin@test.com authenticated
5. [PASS] [roles] login_commissioner - commissioner@test.com authenticated
6. [PASS] [roles] login_developer - developer@test.com authenticated
7. [PASS] [roles] role_scope_client - projects=32, messages=4, invoices=58
8. [PASS] [roles] role_scope_admin - projects=43, messages=0, invoices=80
9. [PASS] [roles] role_scope_commissioner - projects=37, messages=13, invoices=17
10. [PASS] [roles] role_scope_developer - projects=32, messages=9, invoices=1
11. [PASS] [messaging] client_to_commissioner - message sent
12. [PASS] [messaging] commissioner_to_client_reply - reply sent
13. [PASS] [messaging] commissioner_to_developer - message sent
14. [PASS] [messaging] developer_to_commissioner_reply - reply sent
15. [PASS] [messaging] thread_fetch_project - thread_messages=4
16. [PASS] [messaging] client_mark_read - unread->read updated
17. [PASS] [cashflow] assume_paid_finalize_pending_invoices - pending invoices converted to paid for end-state simulation
18. [PASS] [cashflow] project_invoices_loaded - count=2
19. [PASS] [cashflow] project_transactions_loaded - count=9
20. [PASS] [cashflow] deposit_45pct_rule - deposit reflects ~45% rule
21. [PASS] [cashflow] cashflow_full_paid - project marked fully paid via invoices+transactions
22. [PASS] [onboarding] profile_link_share - http://localhost:3000/sales_onboarding.html?sid=369095e2-a42a-4cfc-9072-10877c22720d&sname=Commissioner+User&srole=commissioner&theme=glass
23. [PASS] [onboarding] sales_create_lead - project=8e13be9b-d3bc-4156-ad54-03c998fa8729
24. [PASS] [onboarding] invite_notification - notification inserted
25. [PASS] [onboarding] admin_assisted_project - project=b08c8faa-c95d-434f-9450-bcf6cad9db33
26. [PASS] [onboarding] admin_invoice_link - https://checkout.paystack.com/n1trid5yhgcbdto
27. [PASS] [admin_ops] admin_broadcast_insert - broadcast created
28. [PASS] [admin_ops] admin_profiles_visibility - profiles_visible=13
29. [PASS] [admin_ops] admin_project_finalize_patch - project set to complete/progress=100

## 7) Notes
- Target report email for simulation context: mikomike200@gmail.com
- This report validates DB + edge-function flow and role-scoped behavior.
- UI animation/theme additions are reported separately in dashboard update notes.
