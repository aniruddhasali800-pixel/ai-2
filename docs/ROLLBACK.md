# Rollback

Rolling this service back means three separate things, and conflating them is how an operator destroys
data while trying to undo a deploy: **the code**, **the deployment**, and **the records**. Each has its own
procedure below, and each states what it cannot undo.

Read `docs/STORAGE_DATA_PROTECTION.md` first. Nothing in this file works without a snapshot, and one exists
now: `backend\.data\backups\2026-11-03T05-37-42-899Z`, 158 files, 999,860 bytes, 1,049 records,
digest-verified and proven to load through the application's own reader.

## 0. Before anything else

```powershell
Set-Location "D:\New folder (2)\backend"
git status                                        # what is uncommitted right now
npm run archive:backup                            # a snapshot taken *after* the problem started
npm run archive:verify -- ".data\backups\<the one it just printed>"
```

The second snapshot matters even when the rollback will restore an older one: it is the evidence of what
the service did between the good snapshot and the moment you noticed. Restoring over it without keeping it
means nobody will know later whether the bad deploy lost records or never had them.

**Never restore while the server is running against that folder.** Two processes on one archive overwrite
each other — demonstrated in `docs/STORAGE_DATA_PROTECTION.md` §2 — so a restore into a live folder is not
a rollback, it is a race.

## 1. Roll back the code

Revert forward. The repository is on `main` and is shared, so history is not rewritten:

```powershell
Set-Location "D:\New folder (2)"
git log --oneline -15                             # find the last commit that was good
git revert --no-commit <bad-sha>                  # or a range: <good>..<bad>
git status                                        # read what is about to change
git diff --cached --stat
git commit -m "Revert <what broke>"
```

`git revert` is safe because it creates new commits. **`git reset --hard`, `git clean -fd` and
`git push --force` are not rollback procedures on this repository** — the first two discard uncommitted
work, and the working tree is dirty right now: 19 modified files plus a score of untracked paths, including
the new docs, the archive scripts and the webhook tests. If a rollback ever needs a hard reset, the
uncommitted work is stashed first with a tagged message and only the local branch moves.

Then let the host build the reverted tree — `DEPLOYMENT.md` §6 — and confirm the running build is the one
you intended:

```powershell
Invoke-RestMethod "https://<host>/api/health" | Format-List ok, env, service, dataFolder, time
```

## 2. Roll back the deployment without rolling back the code

Render keeps every previous build, and sometimes the right move is to point the URL back rather than
rebuild:

1. Render dashboard → the service → **Logs & Activity → Activity** → the last good deploy →
   **Rollback to this commit**. Render starts building that commit; it is a new deploy, not an instant
   swap.
2. Watch the health endpoint until it answers, then run the §7 smoke checks in `DEPLOYMENT.md`.

This is the option to prefer when the failure is "the new build does not boot", because it needs no local
checkout and no commit. It is the wrong option when the failure is a bad migration — see §5.

## 3. Roll back the records

This is the procedure the archive scripts exist for. It is deliberately conservative: **it never deletes
the copy it is replacing.**

```powershell
Set-Location "D:\New folder (2)\backend"
# Stop the server that owns the folder first, or the restore loses a race with it.

npm run archive:restore -- ".data\backups\2026-11-03T05-37-42-899Z" --force
```

What that command does, in order, and why each step is in that order:

1. Reads `manifest.json` and refuses anything that is not a snapshot.
2. Takes a **safety copy of the live folder first**, so the state you are rolling *away from* is also
   preserved. It prints the path.
3. Copies the snapshot into a staging folder and removes its manifest from the copy.
4. Parks the live folder aside as `archive.replaced-<timestamp>`. It does not delete it.
5. Moves the staged copy into `ARCHIVE_DIR` and reports how many records are now live.

Then start the server and confirm the count it reports matches the snapshot it came from:

```powershell
npm run dev        # logs `[store] 1049 records across 112 files in …`
```

The restore is covered by `backend/tests/archiveCommands.test.ts`, which runs the real child-process
commands and re-opens the restored folder to assert the records are readable, not merely present.

### Undoing a restore

The parked folder is the previous state. Rename it back:

```powershell
Set-Location "D:\New folder (2)\backend\.data"
Get-ChildItem -Directory -Filter "archive.replaced-*" | Sort-Object LastWriteTime -Descending | Select-Object -First 3
Rename-Item "archive" "archive.restored-mistake-<timestamp>"
Rename-Item "archive.replaced-<timestamp>" "archive"
```

Nothing here is deleted, so a mistake costs a rename, not data. When the folder is right, delete the
scratch copy — and only after `npm run archive:verify` passes against the folder you are keeping.

## 4. Roll back the environment

Two directions, and only one of them is safe to do alone.

**Changing any variable's value invalidates every session or every webhook signature.** A new
`ACCESS_TOKEN_SECRET` signs every access token on the floor and the socket handshake out; expect staff to
sign in again. Clearing or changing a webhook key mid-window means deliveries signed with the key it is
being moved off start answering 401 — which is why `*_WEBHOOK_SECRET_PREVIOUS` exists
(`docs/ENVIRONMENT_VARIABLES.md`).

**Rolling a rotation back is not a revert.** Once a provider's endpoint has been re-pointed at a new key,
putting the old value back in the dashboard does not make the provider sign with it again. The correct
sequence if a rotation must be undone is: re-point the provider back in *its* dashboard first, then restore
the host variable. Doing it the other way opens a window in which the app believes a key the provider no
longer uses and rejects the key the provider is actually signing with, which is an outage that looks like a
signature bug.

Render: Dashboard → Environment → edit → **Restart**, not Deploy (a Deploy on the free plan recreates the
archive empty — `DEPLOYMENT.md` §5).

## 5. Roll back the MongoDB migration

Not applicable yet: no migration has run, and `docs/DATABASE_MIGRATION.md` is a plan. When it does apply,
this is the section that decides whether the program can survive its own cutover, so the rules are stated
before there is pressure:

- **The archive is never deleted by the migration**, and the write freeze plus `archive:backup` happen
  before `--apply`. That means a rollback is "deploy the previous build, with the folder still on disk".
- **Rollback after live traffic costs those writes.** Anything created while MongoDB was authoritative
  exists only in MongoDB. So the rollback window closes the moment real traffic is allowed, and what
  replaces it is a *reverse migration* (documents back out to a folder, or to a second cluster), which is a
  planned artefact, not an emergency command.
- **`AUTO_SEED=false` must survive the rollback.** Rolling back to a build with the default left on means
  a database that looks empty gets a demo tenant written into it, and that is not a rollback.
- **Never roll back the deployment and the database together in one step.** One at a time, verify between
  them, or a failure is ambiguous about which half broke.
- Counters need checking after any rollback that moves authority between stores: `nextSeq` must return
  strictly above the highest order number in whichever store is now authoritative
  (`docs/DATABASE_MIGRATION.md` §6). Otherwise the first order after the rollback collides with one from
  before it.

## 6. What no rollback can undo

Four things, all of them true now:

1. **The published webhook secrets.** They are in Git history and in every clone and fork of it, so they
   are permanently public — which is why the incident is closed by rotation, not by a revert. Deleting a
   value from the current source file does not remove it from history. See
   `docs/SECURITY_INCIDENT_WEBHOOKS.md` §2.
2. **A folder `releaseEmptyFolders` deleted at boot.** `store/index.ts:138` removes any top-level restaurant
   folder holding no recognised records, on every startup, including the startup that happened while the
   operator was still deciding. Only the snapshot taken before it recovers those records.
3. **A deploy on a host with no attached disk.** The archive inside the container's own filesystem is gone
   with the container; `DEPLOYMENT.md` §5. This is why the disk decision comes before the push, not after
   the incident.
4. **Money marked settled.** A forged webhook that settled a bill is a ledger entry. Rolling the code back
   does not un-settle it, and the honest response is to review the payment and order records for
   unexpected status changes and duplicate events — the review steps in
   `docs/SECURITY_INCIDENT_WEBHOOKS.md` §6.

## 7. Rollback rehearsal

A procedure that has never been run is a hypothesis. Run these against copies only, and record the output
the way `docs/STORAGE_DATA_PROTECTION.md` §4 records the backup:

```powershell
Set-Location "D:\New folder (2)\backend"
# 1. Prove the snapshot still verifies and loads.
npm run archive:verify -- ".data\backups\2026-11-03T05-37-42-899Z"

# 2. Prove a restore lands the records somewhere the reader accepts them, without touching the live folder.
Copy-Item ".data\archive" ".data\archive-rehearsal" -Recurse
$env:ARCHIVE_DIR = ".data\archive-rehearsal"
npm run archive:restore -- ".data\backups\2026-11-03T05-37-42-899Z" --force
Remove-Item Env:ARCHIVE_DIR

# 3. Prove the code path: revert the last commit on a throwaway branch, then typecheck, test and build.
Set-Location "D:\New folder (2)"
git switch -c rehearsal/rollback
git revert --no-edit HEAD
Set-Location backend
npm run typecheck; npm test; npm run build
Set-Location "D:\New folder (2)"
git switch main
git branch -D rehearsal/rollback
```

Step 3 runs on a branch so the reverted commit never reaches `main`, and it is the check that the
*previous* build still compiles and passes against today's data shapes — the thing most likely to be
surprising at 2 a.m.

Step 2 is safe because `ARCHIVE_DIR` is resolved from the environment before anything opens the folder
(`config/db.ts:13`), so the live archive is never the target. Delete `.data\archive-rehearsal` afterwards,
and delete nothing else — the snapshots stay.
