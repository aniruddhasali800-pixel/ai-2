// Writes the local .env: a database file, a secret for sessions + payee encryption, and the
// shared secret that signs traffic between this service and Sizzle.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.env');
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

if (existsSync(target)) {
  console.log(`.env already exists at ${target} — left untouched.`);
  process.exit(0);
}

const port = process.env.PORT ?? '3100';
const shared = process.env.SHARED_SECRET ?? token(32);

writeFileSync(
  target,
  [
    '# Local development secrets (gitignored)',
    'DATABASE_URL="file:./dev.db"',
    `APP_SECRET=${token(32)}`,
    `# The same secret lives in Sizzle as BILL_SERVICE_SHARED_SECRET.`,
    `SIZZLE_SHARED_SECRET=${shared}`,
    'PAY_SERVICE_KEY=sizzle-pay',
    'SIZZLE_API_BASE_URL=http://localhost:4000',
    `PUBLIC_URL=http://localhost:${port}`,
    `PORT=${port}`,
    'SEED_OWNER_EMAIL=owner@pay.local',
    `SEED_OWNER_PASSWORD=${token(9)}`,
    'SEED_MANAGER_EMAIL=manager@pay.local',
    `SEED_MANAGER_PASSWORD=${token(9)}`,
    'SEED_CASHIER_EMAIL=cashier@pay.local',
    `SEED_CASHIER_PASSWORD=${token(9)}`,
    'SEED_PAYEE_VPA=demo@okhdfcbank',
    '',
  ].join('\n'),
);

const example = readFileSync(target, 'utf8');
console.log(`Wrote ${target}`);
console.log(`\nAdd this to ${resolve(root, '..', 'backend', '.env')} so Sizzle can reach this service:\n`);
console.log(`BILL_SERVICE_BASE_URL=http://localhost:${port}`);
console.log(`BILL_SERVICE_SHARED_SECRET=${shared}`);
console.log('\nThis service signs people in with the three SEED_*_EMAIL addresses, each against the password written on the line below it. Read them from that file when you seed.');
console.log(`\n(${example.split('\n').length - 1} lines written, secrets are local only.)`);
