// A webhook secret that ships in a repository is not a secret: anyone who can read the repo can sign a
// message that settles a bill. These tests hold the config to that standard in two layers — the pure
// judgement about a single value, and the real behaviour of a process that boots on published defaults.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isPublishableSecret, webhooksAreAccepted, WEBHOOK_SECRET_VARIABLES } from '../src/config/env';

const names = Object.keys(WEBHOOK_SECRET_VARIABLES);

/** The value this repository ships for each variable, so a test can put a process back onto it. */
const publishedDefaults: Record<string, string> = {
  PAYMENT_WEBHOOK_SECRET: 'dev-webhook-secret',
  SWIGGY_WEBHOOK_SECRET: 'dev-swiggy-secret',
  ZOMATO_WEBHOOK_SECRET: 'dev-zomato-secret',
  WEBSITE_WEBHOOK_SECRET: 'dev-website-secret',
};

/** A value of the shape a host would actually hold: 32 random bytes, nothing a template would print. */
const fresh = () => randomBytes(32).toString('hex');

/**
 * Runs the config in a real child process, because refusing to start is something a module does to the
 * process it lives in, not something a test can catch from inside. Only exit codes and the printed
 * report come back, and the report is built to carry variable names rather than values.
 */
function boot(env: Record<string, string>, snippet = "await import('./src/config/env.ts'); console.log('BOOTED');") {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', snippet], {
    // The child's own .env is skipped by naming every variable a test cares about, and the cwd is the
    // backend, which is where tsx resolves the relative import from.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('what counts as a published secret', () => {
  it('rejects blank, template and repository-shipped values', () => {
    const guesses = [
      undefined,
      '',
      '   ',
      ...Object.values(publishedDefaults),
      'dev-access-secret-0000000000',
      'dev-refresh-secret-0000000000',
      'sizzle-pay',
      'sizzle',
      'change-me',
      'CHANGEME',
      'your-secret-here',
      'your_secret_here',
      'example-key',
      'sample-value',
      'dummy-token',
      'placeholder-one',
      'test-only-value',
    ];
    for (const value of guesses) {
      expect(isPublishableSecret(value), `expected ${String(value).slice(0, 4) || 'blank'} to be rejected`).toBe(true);
    }
  });

  it('accepts a value nobody could guess out of the source', () => {
    expect(isPublishableSecret(fresh())).toBe(false);
    expect(isPublishableSecret('a-long-unpredictable-passphrase-for-the-swiggy-webhook')).toBe(false);
    // HMAC does not care how long the key is, so this judgement asks only whether the value is guessable.
    expect(isPublishableSecret('7f3c9b21d4e08a56')).toBe(false);
  });
});

describe('a production process that boots on published webhook secrets', () => {
  it('refuses to start and names every webhook variable', () => {
    const result = boot({ NODE_ENV: 'production', ...publishedDefaults });
    expect(result.code).toBe(1);
    expect(result.output).toContain('Refusing to start in production');
    for (const name of names) expect(result.output).toContain(name);
    expect(result.output).not.toContain('BOOTED');
  });

  it('refuses a webhook secret that is simply unset', () => {
    const result = boot({ NODE_ENV: 'production', PAYMENT_WEBHOOK_SECRET: '', SWIGGY_WEBHOOK_SECRET: '', ZOMATO_WEBHOOK_SECRET: '', WEBSITE_WEBHOOK_SECRET: '' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('PAYMENT_WEBHOOK_SECRET');
  });

  it('refuses two providers that share one secret', () => {
    const shared = fresh();
    const result = boot({
      NODE_ENV: 'production',
      PAYMENT_WEBHOOK_SECRET: fresh(),
      SWIGGY_WEBHOOK_SECRET: shared,
      ZOMATO_WEBHOOK_SECRET: shared,
      WEBSITE_WEBHOOK_SECRET: fresh(),
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('are the same value, so any one provider can forge another');
    expect(result.output).not.toContain(shared);
  });

  it('allows the one pairing that is a single sender: Razorpay and the sandbox route', () => {
    // The checklist tells the operator to register one Razorpay endpoint whose secret fills both
    // variables. Refusing that would make the documented rotation impossible to complete.
    const shared = fresh();
    const result = boot({
      NODE_ENV: 'production',
      PAYMENT_WEBHOOK_SECRET: shared,
      RAZORPAY_WEBHOOK_SECRET: shared,
      SWIGGY_WEBHOOK_SECRET: fresh(),
      ZOMATO_WEBHOOK_SECRET: fresh(),
      WEBSITE_WEBHOOK_SECRET: fresh(),
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('BOOTED');
    expect(result.output).not.toContain(shared);
  });

  it('starts when each provider holds its own secret, and never prints a value', () => {
    const values = {
      NODE_ENV: 'production',
      PAYMENT_WEBHOOK_SECRET: fresh(),
      SWIGGY_WEBHOOK_SECRET: fresh(),
      ZOMATO_WEBHOOK_SECRET: fresh(),
      WEBSITE_WEBHOOK_SECRET: fresh(),
    };
    const result = boot(values);
    expect(result.code).toBe(0);
    expect(result.output).toContain('BOOTED');
    expect(result.output).not.toContain('Refusing to start');
    for (const [name, value] of Object.entries(values)) {
      if (name === 'NODE_ENV') continue;
      expect(result.output, `${name} must not be echoed`).not.toContain(value);
    }
  });
});

describe('a rotation window that holds the key being moved off', () => {
  /** The four live secrets a healthy production host would carry. */
  const healthy = () => ({
    NODE_ENV: 'production',
    PAYMENT_WEBHOOK_SECRET: fresh(),
    SWIGGY_WEBHOOK_SECRET: fresh(),
    ZOMATO_WEBHOOK_SECRET: fresh(),
    WEBSITE_WEBHOOK_SECRET: fresh(),
  });

  it('refuses a retired secret this repository already published', () => {
    const result = boot({ ...healthy(), PAYMENT_WEBHOOK_SECRET_PREVIOUS: 'dev-webhook-secret' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('PAYMENT_WEBHOOK_SECRET_PREVIOUS');
    expect(result.output).not.toContain('dev-webhook-secret');
    expect(result.output).not.toContain('BOOTED');
  });

  it('starts on a genuinely private key that is on its way out', () => {
    const retiring = fresh();
    const result = boot({ ...healthy(), PAYMENT_WEBHOOK_SECRET_PREVIOUS: retiring });
    expect(result.code).toBe(0);
    expect(result.output).toContain('BOOTED');
    expect(result.output).not.toContain(retiring);
  });

  it('refuses a retired key that is another provider live secret', () => {
    const shared = fresh();
    const result = boot({ ...healthy(), SWIGGY_WEBHOOK_SECRET: shared, ZOMATO_WEBHOOK_SECRET_PREVIOUS: shared });
    expect(result.code).toBe(1);
    expect(result.output).toContain('are the same value, so any one provider can forge another');
    expect(result.output).not.toContain(shared);
  });
});

describe('a production host that carries a load-test token', () => {
  it('refuses to start, because that token is a switch for the sign-in rate limits', () => {
    const token = 'a-token-only-a-staging-harness-would-hold';
    const result = boot({
      NODE_ENV: 'production',
      PAYMENT_WEBHOOK_SECRET: fresh(),
      SWIGGY_WEBHOOK_SECRET: fresh(),
      ZOMATO_WEBHOOK_SECRET: fresh(),
      WEBSITE_WEBHOOK_SECRET: fresh(),
      LOAD_TEST_TOKEN: token,
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('LOAD_TEST_TOKEN');
    expect(result.output).not.toContain(token);
    expect(result.output).not.toContain('BOOTED');
  });
});

describe('a deployed host that still holds the published defaults', () => {
  it('keeps serving but closes the webhook routes', () => {
    // This is the live shape: the Render service answers as development, so a crash there would be an
    // unapproved outage. The guard therefore shuts the two webhook routers and says so by name.
    const result = boot({ RENDER_EXTERNAL_URL: 'https://deployed.example.com', ...publishedDefaults },
      "const m = await import('./src/config/env.ts'); console.log('WEBHOOKS_ACCEPTED=' + m.webhooksAreAccepted);");
    expect(result.code).toBe(0);
    expect(result.output).toContain('WEBHOOKS_ACCEPTED=false');
    for (const name of names) expect(result.output).toContain(name);
    for (const value of Object.values(publishedDefaults)) expect(result.output).not.toContain(value.slice(0, 12));
  });

  it('opens the routes again once each provider has its own secret', () => {
    const result = boot({
      RENDER_EXTERNAL_URL: 'https://deployed.example.com',
      PAYMENT_WEBHOOK_SECRET: fresh(),
      SWIGGY_WEBHOOK_SECRET: fresh(),
      ZOMATO_WEBHOOK_SECRET: fresh(),
      WEBSITE_WEBHOOK_SECRET: fresh(),
    }, "const m = await import('./src/config/env.ts'); console.log('WEBHOOKS_ACCEPTED=' + m.webhooksAreAccepted);");
    expect(result.code).toBe(0);
    expect(result.output).toContain('WEBHOOKS_ACCEPTED=true');
  });
});

describe('this test process', () => {
  it('has no public address, so its own signed fixtures stay valid', () => {
    expect(webhooksAreAccepted).toBe(true);
  });
});
