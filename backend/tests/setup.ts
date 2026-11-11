process.env.NODE_ENV = 'test';
// The records are folders on this machine now, so the suite gets its own folder beside the real one.
process.env.ARCHIVE_DIR = '.data/archive-test';
process.env.ACCESS_TOKEN_SECRET = 'test-access-secret-0000000000';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-0000000000';
process.env.PAYMENT_WEBHOOK_SECRET = 'test-payment-webhook-secret';
process.env.SWIGGY_WEBHOOK_SECRET = 'test-swiggy-webhook-secret';
process.env.ZOMATO_WEBHOOK_SECRET = 'test-zomato-webhook-secret';
process.env.WEBSITE_WEBHOOK_SECRET = 'test-website-webhook-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-razorpay-webhook-secret';
// The suite proves what the demo master door does, so it turns the door on with a value only the
// tests know. The shipped default is blank, and dotenv would refill a deleted key from the
// developer's own .env, so this is a test value rather than an unset one.
process.env.DEMO_MASTER_PASSWORD = 'a-master-password-only-tests-know';
// The bill service pairing. The base URL is blanked for the whole suite — a developer's real
// .env points at a live service, and tests must not reach it: the default posture is "nothing
// paired", which is what a fresh checkout runs as. The bill-service test sets it per case.
// Blank, not deleted: env.ts loads dotenv after this file runs, and dotenv fills in any key
// that is missing — a deleted value would come straight back out of the developer's .env.
process.env.BILL_SERVICE_BASE_URL = '';
process.env.BILL_SERVICE_SHARED_SECRET = 'test-bill-service-secret';
process.env.BILL_SERVICE_KEY = 'sizzle-pay';
