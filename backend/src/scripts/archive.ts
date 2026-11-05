/**
 * Back up, verify and restore the record archive, which is the only copy of everything this build holds.
 *
 * The archive is a folder of JSON-lines files, and the server keeps the whole tree in memory and rewrites
 * each file from that copy on every change (src/store/collection.ts). So a backup taken while a server is
 * running is file-consistent — each file is written under a temporary name and renamed, so no single file
 * is ever half-written — but not cross-file consistent, and that is the risk this script reports rather
 * than hides: it copies until two passes in a row find nothing changing (quiescence), and if it never
 * reaches that it says so in the manifest instead of pretending the snapshot is a point in time.
 *
 * Nothing here prints a record. Verification counts documents and compares digests; a person reading the
 * output learns how much data there is, never what any customer ordered.
 *
 * Usage (from backend/):
 *   npm run archive:backup                 # snapshot into .data/backups/<timestamp>
 *   npm run archive:verify -- <folder>      # prove the snapshot loads and counts match
 *   npm run archive:restore -- <folder>     # copy a snapshot back, refusing to discard anything
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { env } from '../config/env';
import { LAYOUT } from '../store';

const SOURCE = resolve(process.cwd(), env.ARCHIVE_DIR);
// A test that exercises these commands points both variables at a scratch folder, so no trial snapshot
// is ever filed beside the operator's real ones.
const BACKUP_ROOT = resolve(process.cwd(), process.env.ARCHIVE_BACKUP_DIR ?? '.data/backups');

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    // A write in flight lands as `<target>.<pid>.<serial>.tmp` before it is renamed, so copying one
    // would put a half-written record into a snapshot.
    else if (!path.endsWith('.tmp')) out.push(path);
  }
  return out.sort();
}

function digest(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
      .on('error', fail);
  });
}

interface Entry {
  path: string;
  bytes: number;
  sha256: string;
}

async function fingerprint(files: string[], from: string): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const file of files) {
    out.push({ path: relative(from, file).split(sep).join('/'), bytes: (await stat(file)).size, sha256: await digest(file) });
  }
  return out;
}

/** Counts the records in a snapshot by collection, without keeping any of them in memory. */
async function countByCollection(dir: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const file of await walk(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    const text = await readFile(file, 'utf8');
    const named = file.split(sep).join('/').match(/([^/]+)\.jsonl$/)?.[1] ?? 'unknown';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      counts[named] = (counts[named] ?? 0) + 1;
      try {
        JSON.parse(line);
      } catch {
        counts[`__malformed_${named}`] = (counts[`__malformed_${named}`] ?? 0) + 1;
      }
    }
  }
  return counts;
}

async function backup(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(BACKUP_ROOT, stamp);
  if (!existsSync(SOURCE)) {
    console.error(`No archive at ${SOURCE}. Start the server or run the seed before backing up.`);
    process.exit(1);
  }
  await mkdir(dest, { recursive: true });

  // Copy, then re-check every digest and copy again whatever moved. Two quiet passes means the snapshot
  // matches a moment when nothing was being written; anything else is reported as such.
  let quietPasses = 0;
  let entries: Entry[] = [];
  let unstable = 0;
  for (let attempt = 1; attempt <= 5 && quietPasses < 2; attempt += 1) {
    const files = await walk(SOURCE);
    const before = await fingerprint(files, SOURCE);
    for (const entry of before) await cp(join(SOURCE, entry.path), join(dest, entry.path), { force: true });
    const after = await fingerprint(await walk(SOURCE), SOURCE);
    const changed = after.filter((entry, index) => entry.sha256 !== before[index]?.sha256 || entry.path !== before[index]?.path);
    entries = after;
    if (changed.length === 0) quietPasses += 1;
    else {
      quietPasses = 0;
      unstable = changed.length;
      console.log(`[backup] ${changed.length} file(s) changed while copying — re-copying (pass ${attempt})`);
    }
  }

  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  const manifest = {
    takenAt: new Date().toISOString(),
    source: SOURCE,
    files: entries.length,
    bytes,
    /**
     * Whether the snapshot is a single moment. `false` means a server was writing during the copy, so
     * records that span two files may disagree with each other — a real limitation, not a warning to
     * ignore, and the reason the restore test below is the part that matters.
     */
    quiescent: quietPasses >= 2,
    filesChangingDuringCopy: unstable,
    collections: await countByCollection(dest),
    entries,
  };
  await writeFile(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[backup] ${entries.length} files, ${bytes} bytes → ${dest}`);
  console.log(`[backup] ${manifest.quiescent ? 'consistent: nothing changed while copying' : 'NOT fully consistent: a server was writing during the copy'}`);
  for (const layout of LAYOUT) {
    const named = layout.file;
    const count = manifest.collections[named] ?? 0;
    if (count) console.log(`  ${layout.model}: ${count}`);
  }
  const malformed = Object.entries(manifest.collections).filter(([key]) => key.startsWith('__malformed_'));
  for (const [key, count] of malformed) {
    console.error(`  [data loss] ${count} unreadable line(s) in ${key.replace('__malformed_', '')} — the loader skips these silently`);
  }
  console.log(`[backup] manifest: ${join(dest, 'manifest.json')}`);
  return dest;
}

async function verify(target: string) {
  const dir = resolve(target);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(dir) || !existsSync(manifestPath)) {
    console.error(`Nothing to verify at ${dir}. Give the folder a backup printed by npm run archive:backup.`);
    process.exit(1);
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: Entry[]; collections: Record<string, number> };

  const now = (await fingerprint(await walk(dir), dir)).filter((entry) => entry.path !== 'manifest.json');
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry.sha256]));
  const broken = now.filter((entry) => expected.get(entry.path) !== entry.sha256);
  const missing = manifest.entries.filter((entry) => !now.some((file) => file.path === entry.path));

  // The proof that matters: load the snapshot through the application's own reader, in a throwaway copy
  // so a verification can never write to the backup it is checking. Opening a folder releases any
  // restaurant folder that holds no records, so it must never be the snapshot itself.
  const scratch = join(BACKUP_ROOT, `.verify-${Date.now()}`);
  await cp(dir, scratch, { recursive: true });
  await rm(join(scratch, 'manifest.json'), { force: true });
  // A collection only registers when its model file runs, so without this import the reader knows no
  // file name at all and would report an empty archive for a snapshot that is full.
  await import('../models');
  const { startStore, inventory, resetStore } = await import('../store');
  const loaded = await startStore(scratch);
  const perFile = inventory();
  resetStore();
  await rm(scratch, { recursive: true, force: true });

  const totals: Record<string, number> = {};
  for (const file of perFile) {
    const named = file.file.split('/').pop()?.replace('.jsonl', '') ?? 'unknown';
    totals[named] = (totals[named] ?? 0) + file.documents;
  }

  console.log(`[verify] ${dir}`);
  console.log(`[verify] files: ${now.length} (${missing.length} missing, ${broken.length} changed since the manifest was written)`);
  console.log(`[verify] the application reader loaded ${loaded.documents} documents from ${loaded.files} files`);
  let mismatch = 0;
  for (const [collection, count] of Object.entries(manifest.collections)) {
    if (collection.startsWith('__malformed_')) continue;
    const read = totals[collection] ?? 0;
    if (read !== count) {
      mismatch += 1;
      console.error(`  [mismatch] ${collection}: snapshot holds ${count} lines, the reader loaded ${read}`);
    }
  }
  const unreadable = Object.entries(manifest.collections).filter(([key]) => key.startsWith('__malformed_'));
  for (const [key, count] of unreadable) {
    console.error(`  [data loss] ${key.replace('__malformed_', '')}: ${count} line(s) are not valid JSON and will not be loaded`);
  }
  if (missing.length || broken.length || mismatch) {
    console.error('[verify] FAILED — this snapshot is not trustworthy as a restore point.');
    process.exit(1);
  }
  console.log('[verify] OK — every file matches its digest and every record loads back through the app.');
}

async function restore(target: string, forced: boolean) {
  const dir = resolve(target);
  if (!existsSync(join(dir, 'manifest.json'))) {
    console.error(`Refusing to restore ${dir}: no manifest, so it is not a snapshot this script made.`);
    process.exit(1);
  }
  if (!forced) {
    console.error(
      'Restore replaces the live archive, so it needs --force. Stop the server first (a running process ' +
        'holds its own copy of every record in memory and will write it back over what you restore), ' +
        'then run: npm run archive:restore -- <folder> --force',
    );
    process.exit(1);
  }
  // Never destroy the only copy: whatever is live right now becomes a snapshot of its own first, and the
  // restore is refused if that safety copy cannot be made. Restoring onto an empty drive has nothing to
  // protect, so it says so instead of failing.
  if (existsSync(SOURCE)) {
    const safety = await backup();
    console.log(`[restore] the live archive was copied into ${safety} first`);
  } else {
    console.log(`[restore] nothing is live at ${SOURCE}, so there was no data to keep a safety copy of`);
  }

  const scratch = join(BACKUP_ROOT, `.restore-${Date.now()}`);
  await cp(dir, scratch, { recursive: true });
  await rm(join(scratch, 'manifest.json'), { force: true });
  const live = resolve(SOURCE);
  const wasLive = existsSync(live);
  const parked = `${live}.replaced-${Date.now()}`;
  if (wasLive) await rename(live, parked);
  await cp(scratch, live, { recursive: true });
  await rm(scratch, { recursive: true, force: true });

  const counts = await countByCollection(live);
  const records = Object.entries(counts)
    .filter(([name]) => !name.startsWith('__malformed_'))
    .reduce((total, [, count]) => total + count, 0);
  console.log(`[restore] ${records} records now live at ${live}`);
  if (wasLive) {
    console.log(`[restore] what was live before is kept at ${parked} — delete it yourself once you have looked at it`);
  }
  console.log('[restore] the server reads this folder at boot; start it and check the counts against the snapshot manifest.');
}

const [command, ...rest] = process.argv.slice(2);
const target = rest.find((argument) => !argument.startsWith('--'));
if (command === 'backup') await backup();
else if (command === 'verify' && target) await verify(target);
else if (command === 'restore' && target) await restore(target, rest.includes('--force'));
else {
  console.log('Usage: npm run archive:backup | archive:verify -- <folder> | archive:restore -- <folder> --force');
  process.exit(1);
}
