# Sizzle Documentation

Engineering documentation for the Sizzle Restaurant OS.

- [System Design & System Map](./SIZZLE_SYSTEM_DESIGN.md) - architecture, request lifecycle, data and realtime flow.
- [AI Backend System Prompt](./SIZZLE_AI_SYSTEM_PROMPT.md) - reusable prompt for code agents working in this repository.
- [Development Workflow](./SIZZLE_DEVELOPMENT_WORKFLOW.md) - manual planning, AI implementation and verification gates.
- Full A4 visual handbook: generate/download `Sizzle_System_Design_Development_Handbook.pdf` from the delivered chat file. The GitHub write connector available here does not support binary PDF uploads.

## Security, data protection and scaling program

Read in this order; each one states what it has proven and what it has not.

- [Security incident: webhook secrets](./SECURITY_INCIDENT_WEBHOOKS.md) — the published signing keys, the containment, the rotation procedure, and the conditions for closing it.
- [Storage audit and data protection](./STORAGE_DATA_PROTECTION.md) — how the record archive really behaves, the backup that exists, and the restore that was proven.
- [Architecture audit](./ARCHITECTURE.md) — what the repository is, the request path, and the finding register every later decision refers to.
- [Scaling plan](./SCALING_PLAN.md) — four separate capacity numbers, and the staged P0–P6 work with its gates.
- [MongoDB migration plan](./DATABASE_MIGRATION.md) — replacing the file-backed persistence, the migration script's requirements, and the verification that makes it count.
- [Security](./SECURITY.md) — authentication, authorization, tenancy, rate limiting and secrets as implemented, plus the ordered list of gaps.
- [Environment variables](./ENVIRONMENT_VARIABLES.md) — every variable the API reads, what it governs, and how the boot guard judges its value.
- [Deployment](./DEPLOYMENT.md) — the verified live topology and what each stage changes about it; the runbook itself is [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
- [Load testing](./LOAD_TESTING.md) — what the existing report proves, what it does not, and the staged runs.
- [Rollback](./ROLLBACK.md) — code, deployment, records, environment and migration rolled back separately, and what no rollback can undo.
