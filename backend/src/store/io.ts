// The only place in the backend that touches the disk for record data.
//
// Writes go to a temporary file and are then renamed over the target, because a crash halfway
// through writing a bill file must leave the previous version intact rather than a truncated one.
// Two writes to the same file are queued behind each other so the rename can never race itself.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

let root = resolve(process.cwd(), '.data', 'archive');

export function setRoot(dir: string): void {
  root = resolve(dir);
}

export function getRoot(): string {
  return root;
}

export function absolute(relative: string): string {
  return join(root, relative);
}

export async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(absolute(filePath)), { recursive: true });
}

const locks = new Map<string, Promise<void>>();

/** Rewrites a whole file, one JSON document per line, and waits until it is on disk. */
export function writeLines(filePath: string, lines: string[]): Promise<void> {
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.then(() => doWrite(filePath, lines));
  // The chain must survive a failed write, or one bad rename would block the file forever.
  locks.set(filePath, next.catch(() => undefined));
  return next;
}

let tempSerial = 0;

async function doWrite(filePath: string, lines: string[]): Promise<void> {
  const target = absolute(filePath);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${(tempSerial = (tempSerial + 1) % 1000)}.tmp`;
  try {
    await writeFile(temp, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function readLines(filePath: string): Promise<string[]> {
  try {
    const text = await readFile(absolute(filePath), 'utf8');
    return text.split('\n').filter((line) => line.trim().length > 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** A file that holds nothing holds nothing: it is removed rather than left as an empty line count. */
export async function removeFile(filePath: string): Promise<void> {
  await rm(absolute(filePath), { force: true });
}

/** Every file under the root, so boot can find documents written before this process started. */
export async function walk(dir = ''): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(absolute(dir), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  for (const entry of entries) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(relative)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(relative);
  }
  return found;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(absolute(filePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * A whole file that is not a record collection — a generated day-close report or its CSV — written
 * through the same queue as the records, so two reports for the same day cannot trample each other.
 */
export async function writeText(filePath: string, text: string): Promise<void> {
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    const target = absolute(filePath);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${(tempSerial = (tempSerial + 1) % 1000)}.tmp`;
    try {
      await writeFile(temp, text, 'utf8');
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
  });
  locks.set(filePath, next.catch(() => undefined));
  return next;
}

/** The file's contents, or null when it has not been written yet. */
export async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(absolute(filePath), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Every file directly inside a folder, whatever its extension — what a reports folder is listed by. */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(absolute(dir), { withFileTypes: true });
    return entries.filter((one) => one.isFile()).map((one) => one.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** The folder names taken at the top of the tree, so a new restaurant is never handed one that exists. */
export async function topFolders(): Promise<string[]> {
  try {
    const entries = await readdir(absolute(''), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
