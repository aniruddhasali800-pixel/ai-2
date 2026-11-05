# Storage audit and data protection

Everything this build knows about its restaurants lives in one folder of text files on the machine that
runs the API. There is no database server behind it, no replica beside it, and no scheduled copy of it.
That makes this folder the single point of failure for the whole product, so it is the first thing worth
protecting and the first thing worth understanding before any scaling work begins.

This document records what the storage layer actually does — measured, not assumed — the backup that now
exists because of it, and the exact commands to reproduce or restore it.

## 1. What the archive is

| Fact | Measured value on 2026-11-03 |
| --- | --- |
| Path | `D:\New folder (2)\backend\.data\archive` (`ARCHIVE_DIR`, resolved against the process working directory — see `backend/src/config/db.ts:13`) |
| Format | JSON lines: one record per line, one file per collection per day where the collection is partitioned |
| Files | 172 in total — 112 `.jsonl` record files, 23 `.json` and 23 `.csv` generated day-close reports, 14 abandoned `.tmp` |
| Records | 1,049 documents across the 18 collections that hold any (20 are declared in `backend/src/store/layout.ts`) |
| Size | 999,860 bytes copied (about 1.0 MB) once in-flight `.tmp` files are excluded |
| Busiest file | `Saffron & Smoke/orders/2026-11-01/orders.jsonl`, 199,636 bytes |

The tree is deliberately readable without this repository: one folder per restaurant, a named folder per
kind of record, and the records that pile up day by day split one file per date. Opening
`.data/archive` in Explorer shows the tenants and their history directly.

## 2. The five questions the audit had to answer

These were asked because the answer decides whether a second backend instance is safe. It is not.

### Are writes serialized within one process?

**Yes, per file, and one defect has been fixed.** Every write goes through the queue in
`backend/src/store/io.ts:30`, which chains each file path onto the previous write of the same path, so two
concurrent requests can never interleave halves of a file. Writes are also *whole-file* rewrites: the
store holds every record of a file in memory and re-emits all of them, so the last writer wins inside its
own process only because there is exactly one writer at a time.

The exception found and closed during this audit was the unique-index check. `Collection.insert` used to
`await` between looking for a duplicate key and adding the document, which let two concurrent inserts of
the same key both pass the check and both land. Two rejected-update paths also mutated the live in-memory
document before the update was validated, so a rejected change could linger and be flushed by the next
whole-file rewrite. Both are fixed in `backend/src/store/collection.ts` — the check is synchronous and runs
against a clone — and are covered by regression tests in `backend/tests/store.test.ts`.

### Is the file replacement atomic?

**Per file, yes. Across files, no, and nothing is flushed to hardware.** `doWrite`
(`backend/src/store/io.ts:40`) writes to `<target>.<pid>.<serial>.tmp` and then renames over the target, so
a reader never sees a truncated record file and a failed write removes its own temp. There is no `fsync` of
the file or its parent directory, so after a power loss the rename itself may not have reached the disk —
the previous version is still intact, which is the point, but the newest write can be gone without any
error being reported.

There is no transaction across files. Placing an order touches `orders`, `counters`, sometimes `bills` and
`notifications`, each rewritten separately. A crash between those writes leaves a half-finished business
operation on disk with no way to roll it back.

### Can startup or shutdown overwrite newer data?

Startup reads; it does not write, with one exception that deserves to be known.
`connectDb` (`backend/src/config/db.ts:11`) only loads the tree, and `src/server.ts:29` seeds demo data
only when no restaurant exists at all, so an archive with records in it is never reseeded over.

The exception is `releaseEmptyFolders` (`backend/src/store/index.ts:138`), which runs at the end of every
startup: any top-level restaurant folder that ends up holding no *recognised* records is deleted from the
disk. It exists so a wiped-and-reseeded install does not leave "Saffron & Smoke 2" behind, but the
consequence is that a folder the loader cannot read — every line malformed, or records written under a
file name no collection declares — is treated as an empty shell and removed. This is the strongest
argument in this document for taking a backup before starting a server on a folder you care about.

Shutdown does not flush anything, because each write already completed when it was issued. What shutdown
does *not* do is clean up a temp file left by a process killed mid-write: 14 such files sit in the live
archive right now, all named with PID 22056, from a dev server that was killed while rewriting bill files.
They are invisible to the loader (`backend/src/store/index.ts` reads only `.jsonl`) and are pure litter,
but their existence proves the crash path leaves debris that nothing ever removes.

### Can multiple processes use the same archive directory?

**Yes, nothing prevents it — and that combination silently destroys records.** There is no lock file, no
lease, and no ownership check; the only guard is that nobody has yet pointed two processes at the folder.
Measured directly, with two processes loaded into the same throwaway archive:

```
[B] loaded the archive and sees 0 counters
[A] wrote 5 counters; the file holds 5 lines; A sees 5 in memory
[B] wrote 1 counter; the file now holds 1 lines
[A] A still holds 5 counters in memory; the file holds 1
lines on disk: 1
keys: B1
```

Five records that were safely on disk were erased by one write from a process that had loaded the folder
before they existed. The process that lost them never saw an error and still believes it is holding them.
This is why the rule is absolute:

> **Never run two backend instances against one archive directory while this storage adapter is active.**
> A load balancer in front of two of them does not spread load, it splits the restaurant's data into two
> diverging snapshots and then lets whichever process wrote last overwrite the other.

The same applies to a server plus any script that opens the same folder, including the seed.

### Does every feature use this adapter, or does some code use Mongoose directly?

Every model in `backend/src/models` is registered through `defineModel` (`backend/src/store/index.ts:51`),
which hands back the file-backed collection instead of a Mongoose model; `mongoose` is imported only for
its `Schema`, `Types` and casting, and `connectDb` never opens a network connection. So no feature reads a
different store than the one this document describes.

Worth naming separately: nothing in `src/` or `tests/` opens a network database connection, and there is no
connection string in the config at all. The `bill/` service, though, is a genuinely separate store — its
own Prisma + SQLite file — which is not in this archive and is not covered by these commands; see
section 6. So is `backend\uploads`, where uploaded images are written outside the record tree.

### The two folders nobody uses any more

`mongodb-memory-server` is still a dependency and `npm run build` still passes it to tsup as `--external`,
but no source file or test references it. What it left behind is on the drive: `.data\mongo` is 333 MB and
`.data\mongo-test` is 327 MB, both untouched since the file store replaced them.

Those folders are *not* covered by any command in this document, and they may hold the last copy of records
written before the current archive existed — the earlier database files were never dumped or migrated. They
are therefore left exactly where they are. Before anything deletes them, read them with the binary that
wrote them and confirm they hold nothing worth keeping.

## 3. Backing the archive up

Three npm scripts in `backend` do the work. They print counts, sizes and digests only — never a record —
so their output is safe to paste into an issue or a chat.

```powershell
cd "D:\New folder (2)\backend"

# 1. Snapshot the live archive into .data\backups\<UTC timestamp>
npm run archive:backup

# 2. Prove that snapshot is intact and readable by the application itself
npm run archive:verify -- ".data\backups\<the folder the previous command printed>"

# 3. Put a snapshot back, only when you mean it
npm run archive:restore -- ".data\backups\<folder>" --force
```

`archive:backup` copies every file except in-flight `.tmp`, then re-checks every digest and copies again
whatever moved, up to five passes. Two passes with nothing changing means the snapshot matches a moment in
time, and the manifest records `quiescent: true`. If a server was writing the whole time, the manifest
records `quiescent: false` and the script says so out loud rather than handing over a snapshot that looks
clean. Copy what it reports honestly.

The manifest beside the copies holds a SHA-256 and byte count per file, plus a line count per collection
and a separate bucket for lines that are not valid JSON — the ones the loader skips silently, which is how
quiet data loss becomes visible.

`archive:verify` does two things. It re-hashes every file against the manifest and reports missing or
changed files, and it then loads the snapshot **through the application's own store reader** in a throwaway
copy, so a verification can prove the records parse and count correctly without any risk of touching the
backup it is checking. Verification opens a folder the way a server boot does, and a server boot releases
empty restaurant folders — hence the copy.

`archive:restore` refuses to run without `--force`, and even with it, whatever is live is snapshotted first
and then *parked* beside the archive as `.data\archive.replaced-<timestamp>` instead of being deleted. The
restore is refused outright if that safety copy cannot be made. Nothing in these three commands ever
removes a copy of existing data; the parked folder is left for a person to delete after looking at it.

## 4. The backup that exists right now

| | |
| --- | --- |
| Location | `D:\New folder (2)\backend\.data\backups\2026-11-03T05-37-42-899Z` |
| Taken | 2026-11-03 05:37:43 UTC (manifest `takenAt`) |
| Contents | 158 files, 999,860 bytes, 1,049 records, `quiescent: true` |
| Verified | 0 files missing, 0 changed, and the application reader loaded 1,049 documents from 112 files |
| Restore proven | Restored into a throwaway folder, which then loaded 1,049 documents across the same 18 collections, with the live archive untouched at 172 files |

Per-collection counts at that moment: orders 260, notifications 275, audit 55, requests 53, bills 81,
payments 80, movements 72, products 41, categories 20, items 20, tables 29, counters 19, login-ids 12,
sessions 12, restaurants 4, login-codes 4, addons 6, bookings 6.

An earlier snapshot at `.data\backups\2026-11-03T05-34-27-044Z` is still on disk. It was taken before the
script learned to skip in-flight `.tmp` files, so it carries the 14 strays along with everything else. Its
record files are byte-identical and it verifies as a restore point; it is simply untidy, and deleting it is
the operator's call, not something these scripts will do.

Backups live under `.data\`, which is git-ignored, so a snapshot of customer records cannot be committed by
accident. That also means a snapshot is only as safe as the drive it sits on.

### The copies these scripts do not make

Two other stores hold data the record archive does not, so a backup that stops at the archive is
incomplete. Copy them beside it:

```powershell
cd "D:\New folder (2)"
$stamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
$out = "D:\sizzle-backups\$stamp"
New-Item -ItemType Directory -Force -Path $out | Out-Null

# Uploaded images — 20 files, 17 MB on 2026-11-03
Copy-Item -Path "backend\uploads" -Destination "$out\uploads" -Recurse

# The bill service's own database — 140 KB (bill\dev.db) and 128 KB (bill\test.db) on 2026-11-03
Copy-Item -Path "bill\dev.db","bill\test.db" -Destination "$out" -ErrorAction SilentlyContinue
```

Neither is in version control — `backend/uploads/` is ignored by the root `.gitignore` and `bill/dev.db` by
`bill/.gitignore` — so copying them somewhere the machine itself is not — a second disk, a synced folder —
is what turns this from tidiness into protection.

## 5. Restore procedure

1. Stop the API process. A running server holds its own copy of every record in memory and will write it
   back over whatever you restore underneath it.
2. Take a snapshot of the current state first — `npm run archive:backup` — even if you believe it is
   broken. A snapshot of a damaged archive is evidence about what went wrong.
3. Verify the snapshot you intend to use: `npm run archive:verify -- "<folder>"`. Do not restore a snapshot
   that fails verification; check the drive it sits on instead.
4. `npm run archive:restore -- "<folder>" --force`. Read the two paths it prints: where the safety copy went
   and where the previously-live folder was parked.
5. Start the server and check its boot line. `connectDb` prints
   `[store] <n> records across <m> files in <dir>`; the count must match the snapshot manifest.
6. Spot-check in the UI for the affected tenant: today's orders, the bill you remember, the table that was
   open. Numbers matching is not the same as the right records.
7. Only after step 6, delete the parked `.replaced-` folder if you do not want it.

To restore onto a machine with no archive yet, set `ARCHIVE_DIR` to the intended folder if it is not
`.data/archive`, and run step 4 — the script notices there is nothing live and says so instead of failing.

## 6. What this does not protect

- **The `bill/` service.** Its payee UPI configuration, verification queue and income figures live in a
  SQLite file under `bill/`, not in this archive. It needs its own copy step before anything is deployed
  against it. Not covered here.
- **Uploads.** `src/middleware/upload.ts` writes product photos and logos to `backend\uploads`, outside the
  record archive, so `archive:backup` does not reach them. The companion copies in section 3 cover it, and
  the scaling plan proposes object storage instead. A record and its missing photo is a restore that looks
  like it worked.
- **A whole machine.** Both the archive and `.data\backups` sit on the same drive. Until snapshots are
  copied off it — to another disk, a synced folder, or object storage — a failed drive takes the data and
  its backups together.
- **The Render filesystem.** `.data` is not persisted between deploys on the current plan. Every deploy
  starts from an empty folder, which is why the live service re-seeds its demo tenant instead of showing
  yesterday's records. Pull a snapshot before a deploy that could touch it, and treat the deployed archive
  as a cache of whatever the next real database will hold.

## 7. Open durability gaps, stated plainly

1. No `fsync`: the newest write can be lost silently after a power cut, while the file stays well-formed.
2. No cross-file atomicity: a crash mid-operation can leave an order without its bill.
3. Startup deletes restaurant folders that hold nothing it recognises (`releaseEmptyFolders`).
4. Abandoned `.tmp` files accumulate after a hard kill; nothing cleans them and nothing warns about them.
5. One process only, enforced by convention rather than by code — there is no lock that stops a second
   instance from starting and corrupting the first one's records.
6. Reads load the entire tree into memory at boot, so the folder has to fit in RAM; growth is limited by
   the process's memory, not by the disk.

Items 1, 2, 3, 5 and 6 are the reasons the plan replaces this adapter with a real database rather than
patching it. The backup and restore commands above exist so that the replacement can be attempted without
betting the restaurant's history on it.
