// The archive is the only copy of every record this build holds, so its backup, verification and restore
// commands are tested the way a fire extinguisher is tested: by actually pulling the pin in a room that is
// not on fire. Every case here runs the real script in a child process against a throwaway folder under
// the system temp directory, so no operator archive is ever the thing being tried out on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CounterModel } from '../src/models';
import { resetStore, startStore } from '../src/store';

const backend = fileURLToPath(new URL('..', import.meta.url));

let scratch = '';
let live = '';
let backups = '';
/** The snapshot the first case takes, reused by every case that follows it. */
let snapshot = '';

interface Run {
  code: number | null;
  output: string;
}

/** Runs one archive command as its own process, pointed entirely at folders made for this test. */
function run(command: string[], archiveDir: string): Run {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/archive.ts', ...command], {
    cwd: backend,
    env: { ...process.env, ARCHIVE_DIR: archiveDir, ARCHIVE_BACKUP_DIR: backups },
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'sizzle-archive-'));
  live = join(scratch, 'archive');
  backups = join(scratch, 'backups');
  await mkdir(live, { recursive: true });

  await startStore(live);
  await CounterModel.create([
    { key: 'daily:orders:2026-11-01', seq: 7 },
    { key: 'daily:orders:2026-11-02', seq: 3 },
    { key: 'daily:bills:2026-11-02', seq: 12 },
  ]);
  // Hand the folder over to the child processes; this one has no business holding it open.
  resetStore();
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('the archive commands protect what they are pointed at', () => {
  it('copies every record file, skips a write in flight, and counts what it took', async () => {
    // The name a crashed store write leaves behind; a snapshot that carried it would hold half a record.
    await writeFile(join(live, '_index', 'counters.jsonl.999999.1.tmp'), '{"key":"half-written"', 'utf8');

    const first = run(['backup'], live);
    expect(first.code, first.output).toBe(0);
    snapshot = first.output.match(/→ (\S.*)$/m)![1]!.trim();

    const manifest = JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8')) as {
      files: number;
      quiescent: boolean;
      collections: Record<string, number>;
      entries: { path: string }[];
    };
    expect(manifest.files).toBe(1);
    expect(manifest.entries.map((entry) => entry.path)).toEqual(['_index/counters.jsonl']);
    expect(manifest.quiescent).toBe(true);
    expect(manifest.collections.counters).toBe(3);
    // Counts and digests only: the whole point is that a backup report can be pasted anywhere safely.
    expect(first.output).not.toContain('daily:orders');
  });

  it('proves a snapshot reads back through the application itself', () => {
    const checked = run(['verify', snapshot], live);
    expect(checked.code, checked.output).toBe(0);
    expect(checked.output).toContain('the application reader loaded 3 documents');
    expect(checked.output).toContain('[verify] OK');
  });

  it('fails a snapshot whose bytes were changed after it was taken', async () => {
    const tampered = join(scratch, 'tampered');
    await cp(snapshot, tampered, { recursive: true });
    const file = join(tampered, '_index', 'counters.jsonl');
    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim());
    const first = JSON.parse(lines[0]!) as { key: string; seq: number };
    first.seq += 1;
    lines[0] = JSON.stringify(first);
    await writeFile(file, `${lines.join('\n')}\n`, 'utf8');

    const checked = run(['verify', tampered], live);
    expect(checked.code).toBe(1);
    expect(checked.output).toContain('1 changed since the manifest was written');
    expect(checked.output).toContain('FAILED');
  });

  it('refuses a restore it has not been given permission or proof for', () => {
    const withoutForce = run(['restore', snapshot], join(scratch, 'target-one'));
    expect(withoutForce.code).toBe(1);
    expect(withoutForce.output).toContain('--force');

    const notASnapshot = run(['restore', live, '--force'], join(scratch, 'target-two'));
    expect(notASnapshot.code).toBe(1);
    expect(notASnapshot.output).toContain('no manifest');
  });

  it('restores a snapshot onto an empty folder and the records load from it', async () => {
    const target = join(scratch, 'restored');
    const restored = run(['restore', snapshot, '--force'], target);
    expect(restored.code, restored.output).toBe(0);
    expect(restored.output).toContain('nothing is live at');
    expect(restored.output).toContain('3 records now live');

    // The claim that matters is not that the files moved but that the application can open the result.
    await startStore(target);
    const loaded = await CounterModel.find({}).lean();
    expect(new Map(loaded.map((counter) => [counter.key, counter.seq]))).toEqual(
      new Map([
        ['daily:orders:2026-11-01', 7],
        ['daily:orders:2026-11-02', 3],
        ['daily:bills:2026-11-02', 12],
      ]),
    );
    resetStore();
  });

  it('snapshots and parks whatever is live before replacing it', async () => {
    const restored = run(['restore', snapshot, '--force'], live);
    expect(restored.code, restored.output).toBe(0);
    expect(restored.output).toContain('the live archive was copied into');

    // The previous folder is moved aside rather than deleted, so a bad restore is still reversible.
    const parked = (await readdir(scratch)).filter((name) => name.includes('.replaced-'));
    expect(parked).toHaveLength(1);
    const kept = await readFile(join(scratch, parked[0]!, '_index', 'counters.jsonl'), 'utf8');
    expect(kept.split('\n').filter((line) => line.trim())).toHaveLength(3);

    // And the operator now holds two snapshots: the one they restored from, and the one of what they
    // replaced. Neither is thrown away by the script.
    const stored = (await readdir(backups)).filter((name) => !name.startsWith('.'));
    expect(stored).toHaveLength(2);
  });
});
