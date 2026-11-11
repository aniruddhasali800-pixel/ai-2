# Sizzle - Development Workflow (Manual + AI)

## 1. Human decision first

Before asking an AI agent to change code, define:

- the user story;
- the roles that can trigger and see the feature;
- the affected route, data and permission;
- the state transition or invariant;
- the acceptance cases.

## 2. AI inspection phase

Ask the AI to read the relevant implementation before editing:

```text
Inspect the existing route, service, model, constants, frontend consumer, realtime mapping, and tests related to this feature. Do not modify code yet. Report the current flow, the existing invariant, and the smallest set of files that should change.
```

## 3. Backend-first implementation

Recommended order:

`route/input -> validation -> service/domain rule -> model/data -> test -> realtime -> frontend`

Do not duplicate domain truth in the browser.

## 4. Verification gates

```text
backend  : npm run typecheck
backend  : npm run test
backend  : npm run build
frontend : npm run typecheck
live     : smoke-test the deployed URLs
```

The handbook records nine backend test suites covering cashflow/floor rules, orders, pricing, auth, customer app, bookings, UPI, hiring and webhooks.

## 5. What AI must not do

- Do not bypass RBAC by hiding buttons only.
- Do not trust client totals.
- Do not mark payments paid because the UI says they are paid.
- Do not remove the one-fire-per-table merge rule.
- Do not turn waiter assignment into a lock.
- Do not reintroduce Clerk into the current custom JWT auth system.
- Do not add a second source of truth for status, permissions or billing.

## 6. Release mindset

A feature is complete only when the database rule, HTTP contract, tests, realtime behavior, UI consumer and deployment path agree.

When documentation and code disagree, inspect the current code and update the documentation rather than guessing.
