# Deployment — current state and what each stage changes

The step-by-step runbook lives at the repository root: [`../DEPLOYMENT.md`](../DEPLOYMENT.md). It covers
proving the build, the Render Blueprint, hand-created services, every environment variable, what survives a
deploy, and the post-deploy smoke checks. This file does not repeat it. It records the deployment facts that
have been *verified* during this program, and what each scaling stage changes about them, because those two
things are what an operator needs when deciding whether a deploy is safe.

Variable reference: [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md). Rollback:
[`ROLLBACK.md`](ROLLBACK.md).

## Current topology, as observed

| Item | Value | Verified how |
| --- | --- | --- |
| Blueprint | `render.yaml` — one web service, `plan: free`, region `oregon`, `rootDir: backend` | read of the file |
| Build / start | `npm install && npm run build` → `node dist/server.js` | `render.yaml:19-20` |
| Health check | `/api/health`, and it is the **only** probe that exists | `render.yaml:21`, `backend/src/routes.ts:25` |
| Runtime | `NODE_VERSION: '22'` on the host; local development runs Node 24 | `render.yaml:26` |
| Public address | `https://smart.restaurant.aniruddhasali.in`, which serves the client and rewrites `/api`, `/uploads` and `/socket.io` to `https://ai-1-hsus.onrender.com` | `DEPLOYMENT.md` §6, `frontend/vercel.json` |
| Instances | **one.** The free plan offers no second instance and no autoscaling | `render.yaml:16` |
| Persistent disk | **none.** `.data/archive` is recreated empty at every deploy, then reseeded | `render.yaml:8-11`, `DEPLOYMENT.md` §5 |
| Secrets declared | `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` (`sync: false`) — **none of the four webhook keys is in the Blueprint** | `render.yaml:30-36` |
| `MONGODB_URI` | declared in the Blueprint and read by nothing under `src/`; it is listed only so an existing variable is visibly retired | `render.yaml:35`, `DEPLOYMENT.md` §4 |
| Live `NODE_ENV` | the running service answers `"env": "development"`, so its dashboard never set it | `DEPLOYMENT.md` §6 |

Two consequences worth stating plainly:

1. **The Blueprint cannot create a working production service as it stands.** A deployed host refuses to
   accept webhooks until all four signing keys hold their own values
   (`config/env.ts:304`), and `render.yaml` declares none of them. Whoever deploys from this Blueprint gets
   a service whose payment and partner-order endpoints answer `503` until the keys are added by hand.
2. **No deployment of this build is safe for a restaurant that trades.** Every push wipes the archive and
   reseeds the demo tenant. This is finding A-01 in `docs/ARCHITECTURE.md`, and it is the reason the program
   starts with data protection rather than with infrastructure.

`NODE_ENV=production` still has to be set on the live service by the operator, together with the four keys —
the rotation procedure is §4 of `SECURITY_INCIDENT_WEBHOOKS.md`, and the reason a Restart rather than a
Deploy is the correct action is in `ROLLBACK.md` §4.

## What each stage changes about deployment

A stage is not "done" for deployment purposes until its own line below is true on the target, not in the
repository.

| Stage | Deploy-time change | Proof required before the next stage |
| --- | --- | --- |
| P0 · incident + data protection | Four independent webhook keys on the host, plus `NODE_ENV=production`; a snapshot procedure that is run before any push | `/api/health` reports `production`; a signed test delivery settles a bill; an unsigned one is refused; `npm run archive:verify` passes against a real snapshot |
| P1 · replace file persistence | `MONGO_URI` (or equivalent) added; `AUTO_SEED=false` on anything holding real records; `/health/live` and `/health/ready` split, and `healthCheckPath` moved to `/health/live`; server request/socket timeouts set | the 181 tests pass against the real database, unchanged; a second process sees the first's writes |
| P2 · migrate the records | a one-off migration job run from a Render shell against the attached database, not from the web process | every check in `DATABASE_MIGRATION.md` §8 passes; the rollback rehearsal in `ROLLBACK.md` §7 has been run |
| P3 · counters and idempotency | nothing new to deploy — this is the stage that makes deploying twice safe | two concurrent processes racing one counter key produce no duplicate order number |
| P4 · tenant isolation | per-tenant rate limits keyed on the authenticated tenant rather than the IP | the cross-tenant tests pass on all 18 routers |
| P5 · Redis, sockets, workers | a Redis instance, a second service in `render.yaml` with `ROLE=worker` and its own start command, and the Socket.IO Redis adapter | **with two instances**: an event raised on one reaches a client on the other; a Redis outage degrades instead of erroring; a killed worker's job is neither lost nor doubled |
| P6 · multi-instance + capacity | `plan` upgraded, `numInstances` set, a load balancer in front, autoscaling policy written down | the staged runs in `LOAD_TESTING.md` §4 executed against this topology, with the numbers recorded here including the failures |

**Rules that do not lift:** never run two instances while the whole-tree-in-RAM adapter is active, because a
load balancer would be sending requests to processes holding different snapshots of the same folder and each
one overwrites the other. And no code change makes a second Render *free* instance possible — that upgrade
is a purchase, and purchases are the operator's decision (`SCALING_PLAN.md` §6).

## The deploy checklist, for any stage

```powershell
Set-Location "D:\New folder (2)\backend"
npm run typecheck
npm test                                  # 20 files, 181 tests
npm run build                             # the command the host will run
node dist\server.js                       # boot the bundle the way the host does
Invoke-RestMethod "http://127.0.0.1:4000/api/health" | Format-List *
```

Then, on the host: `/api/health` (and later `/health/ready`) answers from the intended environment, the
data folder or database it names is the one that holds the records, webhooks are accepted rather than
closed, and the smoke checks in `DEPLOYMENT.md` §7 pass — onboarding a tenant at `/register`, a menu photo
rendering on the guest menu from a phone, and a guest order repainting the kitchen board with no manual
refresh.
