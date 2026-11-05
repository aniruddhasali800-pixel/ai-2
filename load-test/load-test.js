/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Sizzle Load Testing Tool
 *  Tests: Authentication, 2-Waiter Order Placement, Customer Requests,
 *         Cashier Billing, Mixed Peak Traffic, Sustained Waves, Rate Limiter
 * ═══════════════════════════════════════════════════════════════════════
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.SIZZLE_API_URL || 'http://127.0.0.1:4000';
const REPORT_PATH = process.env.REPORT_PATH || path.join(__dirname, 'load-test-report.json');

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function httpRequest(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) opts.body = JSON.stringify(body);

  const start = performance.now();
  let status, data, error;
  try {
    const res = await fetch(url, opts);
    status = res.status;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (err) {
    status = 0;
    error = err.message;
  }
  const duration = performance.now() - start;

  return { status, data, error, duration, url, method };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function computeStats(results) {
  if (!results.length) {
    return {
      total: 0, passed: 0, failed: 0, rateLimited: 0,
      passRate: '0.0%', failRate: '0.0%',
      avgLatency: '0.0ms', minLatency: '0.0ms', maxLatency: '0.0ms',
      p50: '0.0ms', p90: '0.0ms', p95: '0.0ms', p99: '0.0ms',
      statusCodes: {},
    };
  }

  const durations = results.map(r => r.duration);
  const passed = results.filter(r => r.status >= 200 && r.status < 400);
  const failed = results.filter(r => r.status === 0 || r.status >= 400);
  const rateLimited = results.filter(r => r.status === 429);

  return {
    total: results.length,
    passed: passed.length,
    failed: failed.length,
    rateLimited: rateLimited.length,
    passRate: `${((passed.length / results.length) * 100).toFixed(1)}%`,
    failRate: `${((failed.length / results.length) * 100).toFixed(1)}%`,
    avgLatency: `${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)}ms`,
    minLatency: `${Math.min(...durations).toFixed(1)}ms`,
    maxLatency: `${Math.max(...durations).toFixed(1)}ms`,
    p50: `${percentile(durations, 50).toFixed(1)}ms`,
    p90: `${percentile(durations, 90).toFixed(1)}ms`,
    p95: `${percentile(durations, 95).toFixed(1)}ms`,
    p99: `${percentile(durations, 99).toFixed(1)}ms`,
    statusCodes: results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

class LoadTestRunner {
  constructor() {
    this.results = {};
    this.tokens = {};
    this.discoveredData = {
      products: [],
      tables: [],
      createdOrders: [],
    };
  }

  log(msg) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[${ts}] ${msg}`);
  }

  // ──────── 1. VALID LOGIN & TOKEN HARVESTING ────────
  async testValidLogins() {
    this.log('═══ TEST 1: Staff Authentication (2 Waiters, Cashier, Kitchen) ═══');
    const results = [];

    // The API only skips its own throttling for a run that presents LOAD_TEST_TOKEN, which a production
    // host refuses to start with. Set it here only when pointing at a staging instance that has it.
    const loadTestHeaders = process.env.LOAD_TEST_TOKEN ? { 'x-load-test-auth': process.env.LOAD_TEST_TOKEN } : {};

    const staffAccounts = [
      { identifier: '+91 98200 11005', label: 'Waiter 1 (Sneha)' },
      { identifier: '+91 98200 11006', label: 'Waiter 2 (Imran)' },
      { identifier: '+91 98200 11003', label: 'Cashier (Rohit)' },
      { identifier: '+91 98200 11004', label: 'Kitchen (Vikram)' },
    ];

    for (const account of staffAccounts) {
      // Request OTP code, presenting the harness token when this run was given one
      const otpReq = await httpRequest('POST', '/api/auth/otp/request', {
        phone: account.identifier,
      }, loadTestHeaders);

      let token = null;
      let finalRes = otpReq;

      if (otpReq.status === 200 && otpReq.data?.demoCode) {
        // Verify OTP code
        const otpVerify = await httpRequest('POST', '/api/auth/otp/verify', {
          phone: account.identifier,
          code: otpReq.data.demoCode,
        }, loadTestHeaders);
        finalRes = otpVerify;
        token = otpVerify.data?.accessToken || otpVerify.data?.token;
      }

      results.push({ ...finalRes, label: account.label });

      if (token) {
        this.tokens[account.label] = token;
        this.log(`  ✓ ${account.label} authenticated successfully`);
      } else {
        this.log(`  ✗ ${account.label} authentication failed (${finalRes.status})`);
      }
    }

    this.results.validLogins = {
      description: 'Authenticate floor staff roles (2 Waiters, Cashier, Kitchen) and harvest JWT tokens',
      total: results.length,
      successful: results.filter(r => r.status === 200).length,
      failed: results.filter(r => r.status !== 200).length,
      tokensObtained: Object.keys(this.tokens).length,
      accounts: results.map(r => ({
        label: r.label,
        status: r.status,
        latency: `${r.duration.toFixed(1)}ms`,
        success: r.status === 200,
      })),
    };

    return results;
  }

  // ──────── 2. CONCURRENT API READS (100 PARALLEL) ────────
  async testConcurrentReads() {
    this.log('═══ TEST 2: Concurrent API Reads (100 parallel requests) ═══');
    const results = [];

    const token = this.tokens['Waiter 1 (Sneha)'] || this.tokens['Waiter 2 (Imran)'] || Object.values(this.tokens)[0];
    if (!token) {
      this.log('  ⚠ No auth token available — skipping concurrent reads');
      this.results.concurrentReads = { description: 'Skipped — no auth token available', total: 0 };
      return [];
    }

    const authHeaders = { Authorization: `Bearer ${token}` };

    const endpoints = [
      { method: 'GET', path: '/api/waiters/map', label: 'Waiter Map' },
      { method: 'GET', path: '/api/waiters/requests', label: 'Customer Requests' },
      { method: 'GET', path: '/api/waiters/live-orders', label: 'Live Orders' },
      { method: 'GET', path: '/api/orders?active=true', label: 'Active Orders' },
      { method: 'GET', path: '/api/menu', label: 'Full Menu' },
      { method: 'GET', path: '/api/tables', label: 'Tables List' },
      { method: 'GET', path: '/api/billing?todayOnly=true', label: 'Today Bills' },
      { method: 'GET', path: '/api/notifications', label: 'Notifications' },
      { method: 'GET', path: '/api/auth/me', label: 'My Profile' },
      { method: 'GET', path: '/api/health', label: 'Health Check' },
    ];

    // 100 requests: 10 of each endpoint
    const promises = [];
    for (let i = 0; i < 100; i++) {
      const ep = endpoints[i % endpoints.length];
      promises.push(
        httpRequest(ep.method, ep.path, null, ep.path === '/api/health' ? {} : authHeaders)
          .then(r => ({ ...r, label: ep.label }))
      );
    }

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : { status: 0, duration: 0, error: s.reason?.message });
    }

    // Discover menu items and tables for subsequent tests
    const menuRes = results.find(r => r.label === 'Full Menu' && r.status === 200);
    if (menuRes?.data?.products?.length) {
      this.discoveredData.products = menuRes.data.products.slice(0, 8).map(p => ({
        _id: p._id, name: p.name, price: p.price,
      }));
    }
    const tablesRes = results.find(r => r.label === 'Tables List' && r.status === 200);
    if (tablesRes?.data?.data?.length) {
      this.discoveredData.tables = tablesRes.data.data.slice(0, 10).map(t => ({
        _id: t._id, number: t.number, activeSessionId: t.activeSessionId,
      }));
    }

    const stats = computeStats(results);
    const byEndpoint = {};
    for (const ep of endpoints) {
      const epResults = results.filter(r => r.label === ep.label);
      if (epResults.length) byEndpoint[ep.label] = computeStats(epResults);
    }

    this.results.concurrentReads = {
      description: '100 parallel GET requests across 10 core endpoints simulating concurrent staff activity',
      ...stats,
      byEndpoint,
    };

    this.log(`  ✓ Passed: ${stats.passed} | ✗ Failed: ${stats.failed} | Avg: ${stats.avgLatency} | P95: ${stats.p95}`);
    return results;
  }

  // ──────── 3. TWO-WAITER ORDER CREATION STRESS ────────
  async testTwoWaiterOrderCreation() {
    this.log('═══ TEST 3: Order Placement by 2 Waiters (50 concurrent orders) ═══');
    const results = [];

    const waiter1Token = this.tokens['Waiter 1 (Sneha)'];
    const waiter2Token = this.tokens['Waiter 2 (Imran)'];

    if (!waiter1Token && !waiter2Token) {
      this.log('  ⚠ No waiter tokens available — skipping order creation');
      this.results.twoWaiterOrders = { description: 'Skipped — no waiter auth tokens', total: 0 };
      return [];
    }

    const products = this.discoveredData.products;
    if (!products.length) {
      this.log('  ⚠ No menu products available — skipping order creation');
      this.results.twoWaiterOrders = { description: 'Skipped — no menu products', total: 0 };
      return [];
    }

    const tables = this.discoveredData.tables;

    // Simulate 2 parallel waiters submitting 25 orders each concurrently
    const runWaiterStream = async (waiterLabel, token, count, offset) => {
      const streamResults = [];
      for (let i = 0; i < count; i++) {
        const orderNum = offset + i + 1;
        const orderItems = [
          { productId: products[(offset + i) % products.length]._id, qty: (i % 3) + 1 },
        ];
        if (products.length > 1 && i % 2 === 0) {
          orderItems.push({ productId: products[(offset + i + 1) % products.length]._id, qty: 1 });
        }

        const tableId = tables.length ? tables[(offset + i) % tables.length]._id : undefined;

        const res = await httpRequest('POST', '/api/orders', {
          source: 'DINE_IN_WAITER',
          tableId,
          customerName: `${waiterLabel} Guest #${orderNum}`,
          items: orderItems,
          notes: `Simulated lunch rush order #${orderNum} taken by ${waiterLabel}`,
        }, { Authorization: `Bearer ${token}` });

        streamResults.push({ ...res, waiter: waiterLabel, orderIndex: orderNum });
      }
      return streamResults;
    };

    // Both waiters submit their stream concurrently!
    const [w1Results, w2Results] = await Promise.all([
      runWaiterStream('Waiter 1 (Sneha)', waiter1Token, 25, 0),
      runWaiterStream('Waiter 2 (Imran)', waiter2Token, 25, 25),
    ]);

    results.push(...w1Results, ...w2Results);

    this.discoveredData.createdOrders = results
      .filter(r => r.status === 201 && r.data?._id)
      .map(r => ({ _id: r.data._id, orderNumber: r.data.orderNumber }));

    const stats = computeStats(results);
    this.results.twoWaiterOrders = {
      description: '50 concurrent orders placed simultaneously split between Waiter 1 (Sneha) & Waiter 2 (Imran)',
      ...stats,
      ordersCreated: this.discoveredData.createdOrders.length,
      waiter1Stats: computeStats(w1Results),
      waiter2Stats: computeStats(w2Results),
    };

    this.log(`  ✓ Passed: ${stats.passed} | ✗ Failed: ${stats.failed} | Orders Created: ${this.discoveredData.createdOrders.length} | Avg: ${stats.avgLatency}`);
    return results;
  }

  // ──────── 4. CUSTOMER REQUEST FLOOD & HANDLING ────────
  async testCustomerRequests() {
    this.log('═══ TEST 4: Customer Requests Flood (30 parallel requests) ═══');
    const results = [];

    const waiter1Token = this.tokens['Waiter 1 (Sneha)'];
    const waiter2Token = this.tokens['Waiter 2 (Imran)'];
    const token = waiter1Token || waiter2Token || Object.values(this.tokens)[0];

    if (!token) {
      this.log('  ⚠ No auth token available — skipping customer requests');
      this.results.customerRequests = { description: 'Skipped — no auth token', total: 0 };
      return [];
    }

    const tables = this.discoveredData.tables;
    // Ensure all tables in test have an active session so requests succeed
    for (const t of tables.slice(0, 5)) {
      await httpRequest('POST', `/api/waiters/tables/${t._id}/seat`, {
        guestCount: 2,
        customerName: 'Load Test Party',
      }, { Authorization: `Bearer ${token}` });
    }

    // Valid RequestType constants from src/types/constants.ts
    const validRequestTypes = ['CALL_WAITER', 'WATER', 'PLATE', 'CUTLERY', 'NAPKIN'];

    // 30 operations: mix of raising customer requests and reading live requests
    const promises = Array.from({ length: 30 }, (_, i) => {
      const waiter = i % 2 === 0 ? 'Waiter 1' : 'Waiter 2';
      const useToken = (i % 2 === 0 ? waiter1Token : waiter2Token) || token;

      if (i % 2 === 0 && tables.length) {
        const table = tables[(i / 2) % Math.min(5, tables.length)];
        const reqType = validRequestTypes[i % validRequestTypes.length];
        return httpRequest('POST', '/api/waiters/requests', {
          tableId: table._id,
          type: reqType,
          note: `High-load test call for ${reqType} by ${waiter}`,
        }, { Authorization: `Bearer ${useToken}` }).then(r => ({ ...r, op: 'Raise Request' }));
      } else {
        return httpRequest('GET', '/api/waiters/requests', null, { Authorization: `Bearer ${useToken}` })
          .then(r => ({ ...r, op: 'Read Requests' }));
      }
    });

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : { status: 0, duration: 0, error: s.reason?.message });
    }

    const stats = computeStats(results);
    const byOperation = {
      'Raise Request': computeStats(results.filter(r => r.op === 'Raise Request')),
      'Read Requests': computeStats(results.filter(r => r.op === 'Read Requests')),
    };

    this.results.customerRequests = {
      description: '30 parallel customer requests: raising service calls (water, cutlery, plate) and querying request queues',
      ...stats,
      byOperation,
    };

    this.log(`  ✓ Passed: ${stats.passed} | ✗ Failed: ${stats.failed} | Avg: ${stats.avgLatency}`);
    return results;
  }

  // ──────── 5. CASHIER BILLING & SETTLEMENTS ────────
  async testCashierBilling() {
    this.log('═══ TEST 5: Cashier Billing Operations (30 parallel reads) ═══');
    const results = [];

    const cashierToken = this.tokens['Cashier (Rohit)'] || this.tokens['Waiter 1 (Sneha)'] || Object.values(this.tokens)[0];
    if (!cashierToken) {
      this.log('  ⚠ No cashier token — skipping billing test');
      this.results.cashierBilling = { description: 'Skipped — no cashier token', total: 0 };
      return [];
    }

    const authHeaders = { Authorization: `Bearer ${cashierToken}` };

    const operations = [
      () => httpRequest('GET', '/api/billing?todayOnly=true', null, authHeaders).then(r => ({ ...r, label: 'Today Bills' })),
      () => httpRequest('GET', '/api/billing?unpaidOnly=true', null, authHeaders).then(r => ({ ...r, label: 'Unpaid Bills' })),
      () => httpRequest('GET', '/api/orders?active=true', null, authHeaders).then(r => ({ ...r, label: 'Active Orders' })),
      () => httpRequest('GET', '/api/billing', null, authHeaders).then(r => ({ ...r, label: 'All Bills History' })),
    ];

    const promises = Array.from({ length: 30 }, (_, i) => operations[i % operations.length]());

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : { status: 0, duration: 0, error: s.reason?.message });
    }

    const stats = computeStats(results);
    const byOperation = {};
    for (const label of ['Today Bills', 'Unpaid Bills', 'Active Orders', 'All Bills History']) {
      const sub = results.filter(r => r.label === label);
      if (sub.length) byOperation[label] = computeStats(sub);
    }

    this.results.cashierBilling = {
      description: '30 parallel cashier reads (today bills, unpaid bills, active orders, and bill history)',
      ...stats,
      byOperation,
    };

    this.log(`  ✓ Passed: ${stats.passed} | ✗ Failed: ${stats.failed} | Avg: ${stats.avgLatency}`);
    return results;
  }

  // ──────── 6. MIXED PEAK-HOUR SIMULATION (100 CONCURRENT) ────────
  async testMixedLoad() {
    this.log('═══ TEST 6: Peak Hour Mixed Traffic Simulation (100 parallel) ═══');
    const results = [];

    const w1Token = this.tokens['Waiter 1 (Sneha)'];
    const w2Token = this.tokens['Waiter 2 (Imran)'];
    const cashierToken = this.tokens['Cashier (Rohit)'];
    const kitchenToken = this.tokens['Kitchen (Vikram)'];

    const operations = [
      // Waiter 1 actions (25)
      ...Array.from({ length: 15 }, () => ({
        method: 'GET', path: '/api/waiters/map',
        headers: { Authorization: `Bearer ${w1Token}` }, label: 'Waiter 1: Floor Map',
      })),
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/waiters/live-orders',
        headers: { Authorization: `Bearer ${w1Token}` }, label: 'Waiter 1: Live Orders',
      })),
      // Waiter 2 actions (25)
      ...Array.from({ length: 15 }, () => ({
        method: 'GET', path: '/api/waiters/map',
        headers: { Authorization: `Bearer ${w2Token}` }, label: 'Waiter 2: Floor Map',
      })),
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/waiters/requests',
        headers: { Authorization: `Bearer ${w2Token}` }, label: 'Waiter 2: Requests',
      })),
      // Cashier actions (20)
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/billing?todayOnly=true',
        headers: { Authorization: `Bearer ${cashierToken || w1Token}` }, label: 'Cashier: Today Bills',
      })),
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/orders?active=true',
        headers: { Authorization: `Bearer ${cashierToken || w1Token}` }, label: 'Cashier: Active Orders',
      })),
      // Kitchen actions (10)
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/orders?active=true',
        headers: { Authorization: `Bearer ${kitchenToken || w1Token}` }, label: 'Kitchen: KDS Display',
      })),
      // Public / Staff menu browsing (10)
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/menu', headers: { Authorization: `Bearer ${w1Token}` }, label: 'Menu: Live Feed',
      })),
      // Health monitoring (10)
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/health', headers: {}, label: 'Monitor: Health',
      })),
    ];

    // Shuffle operations
    for (let i = operations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [operations[i], operations[j]] = [operations[j], operations[i]];
    }

    // Fire all 100 requests concurrently
    const promises = operations.map(op =>
      httpRequest(op.method, op.path, null, op.headers).then(r => ({ ...r, label: op.label }))
    );

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : { status: 0, duration: 0, error: s.reason?.message });
    }

    const stats = computeStats(results);
    const labels = [...new Set(operations.map(o => o.label))];
    const byOperation = {};
    for (const label of labels) {
      const sub = results.filter(r => r.label === label);
      if (sub.length) byOperation[label] = computeStats(sub);
    }

    this.results.mixedLoad = {
      description: '100 parallel requests simulating peak service (2 Waiters, Cashier, Kitchen, and Server Health)',
      ...stats,
      byOperation,
    };

    this.log(`  ✓ Passed: ${stats.passed} | ✗ Failed: ${stats.failed} | Avg: ${stats.avgLatency} | P95: ${stats.p95}`);
    return results;
  }

  // ──────── 7. SUSTAINED THROUGHPUT WAVES ────────
  async testSustainedThroughput() {
    this.log('═══ TEST 7: Sustained High Throughput (5 waves × 20 requests) ═══');
    const allResults = [];

    for (let wave = 0; wave < 5; wave++) {
      const promises = Array.from({ length: 20 }, () =>
        httpRequest('GET', '/api/health')
      );
      const settled = await Promise.allSettled(promises);
      for (const s of settled) {
        allResults.push(s.status === 'fulfilled' ? s.value : { status: 0, duration: 0, error: s.reason?.message });
      }
      this.log(`  Wave ${wave + 1}/5 finished`);
      await sleep(150);
    }

    const stats = computeStats(allResults);
    this.results.sustainedThroughput = {
      description: '5 waves of 20 requests with 150ms intervals to test sustained throughput under continuous traffic',
      ...stats,
      waves: 5,
      requestsPerWave: 20,
    };

    this.log(`  ✓ Passed: ${stats.passed} | ✗ Failed: ${stats.failed} | Avg: ${stats.avgLatency} | P95: ${stats.p95}`);
    return allResults;
  }

  // ──────── 8. LOGIN RATE LIMITING VERIFICATION ────────
  async testLoginRateLimit() {
    this.log('═══ TEST 8: Login Rate Limiting (50 rapid requests) ═══');
    const results = [];

    // Rapid-fire 50 bad login requests WITHOUT bypass header to verify 429 Too Many Requests enforcement
    const promises = Array.from({ length: 50 }, (_, i) =>
      httpRequest('POST', '/api/auth/login', {
        identifier: `stress-test-${i}@fake.local`,
        password: 'InvalidPassword123!',
      })
    );

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : { status: 0, duration: 0, error: s.reason?.message });
    }

    const stats = computeStats(results);
    const rateLimitedCount = stats.rateLimited;
    const firstRateLimitIndex = results.findIndex(r => r.status === 429);

    this.results.loginRateLimit = {
      description: '50 rapid unauthorized login requests to verify express-rate-limit protection (limit: 30)',
      ...stats,
      rateLimitTriggered: rateLimitedCount > 0,
      detectedAt: rateLimitedCount > 0
        ? `Rate limit triggered successfully at request #${firstRateLimitIndex + 1}`
        : 'Rate limiter did not trigger',
    };

    this.log(`  ✓ Total: ${stats.total} | ⚠ Rate-limited (429): ${rateLimitedCount} | Result: ${this.results.loginRateLimit.detectedAt}`);
    return results;
  }

  // ──────── REPORT GENERATION ────────
  generateReport() {
    const functionalTests = [
      this.results.validLogins,
      this.results.concurrentReads,
      this.results.twoWaiterOrders,
      this.results.customerRequests,
      this.results.cashierBilling,
      this.results.mixedLoad,
      this.results.sustainedThroughput,
    ].filter(Boolean);

    const totalRequests = Object.values(this.results).reduce((sum, r) => sum + (r.total || 0), 0);
    const totalPassed = Object.values(this.results).reduce((sum, r) => sum + (r.passed || 0), 0);
    const totalFailed = Object.values(this.results).reduce((sum, r) => sum + (r.failed || 0), 0);
    const totalRateLimited = Object.values(this.results).reduce((sum, r) => sum + (r.rateLimited || 0), 0);

    const functionalTotal = functionalTests.reduce((sum, r) => sum + (r.total || 0), 0);
    const functionalPassed = functionalTests.reduce((sum, r) => sum + (r.passed || 0), 0);
    const functionalPassRate = functionalTotal > 0 ? (functionalPassed / functionalTotal) : 1;

    const report = {
      meta: {
        tool: 'Sizzle Enterprise Load Testing Tool',
        version: '1.0.0',
        baseUrl: BASE_URL,
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
      },
      summary: {
        totalRequests,
        totalPassed,
        totalFailed,
        totalRateLimited,
        overallPassRate: functionalTotal ? `${(functionalPassRate * 100).toFixed(1)}%` : '0%',
        overallFailRate: functionalTotal ? `${(((functionalTotal - functionalPassed) / functionalTotal) * 100).toFixed(1)}%` : '0%',
        verdict: functionalPassRate >= 0.95
          ? '✅ PASS — System handles heavy concurrent load with flying colors'
          : functionalPassRate >= 0.80
            ? '⚠️ WARNING — Degraded performance under peak load'
            : '❌ FAIL — System cannot handle this level of traffic',
      },
      tests: this.results,
    };

    return report;
  }

  // ──────── EXECUTION RUNNER ────────
  async run() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║        SIZZLE RESTAURANT — ENTERPRISE LOAD TEST SUITE       ║');
    console.log('║        Target: ' + BASE_URL.padEnd(46) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const startTime = Date.now();

    // 1. Staff authentication first so we have tokens
    await this.testValidLogins();
    await sleep(250);

    // 2. Concurrent reads (100 parallel)
    await this.testConcurrentReads();
    await sleep(250);

    // 3. 2-Waiter Order placement stress
    await this.testTwoWaiterOrderCreation();
    await sleep(250);

    // 4. Customer requests flood
    await this.testCustomerRequests();
    await sleep(250);

    // 5. Cashier billing operations
    await this.testCashierBilling();
    await sleep(250);

    // 6. Mixed peak-traffic simulation (100 parallel)
    await this.testMixedLoad();
    await sleep(250);

    // 7. Sustained throughput waves
    await this.testSustainedThroughput();
    await sleep(250);

    // 8. Rate limit verification (done at end)
    await this.testLoginRateLimit();

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const report = this.generateReport();
    report.meta.totalDuration = `${totalTime}s`;

    // Save JSON report
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    this.log(`\n📊 JSON Report saved to ${REPORT_PATH}`);

    // Generate HTML report
    try {
      this.log('🎨 Generating HTML Visual Dashboard...');
      execSync('node generate-report.mjs', { cwd: __dirname, stdio: 'inherit' });
      this.log(`✨ HTML Dashboard ready at ${path.join(__dirname, 'report.html')}`);
    } catch (err) {
      this.log(`⚠ HTML report generation error: ${err.message}`);
    }

    // Print summary table
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    FINAL BENCHMARK RESULTS                  ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Total Requests:     ${String(report.summary.totalRequests).padEnd(38)}║`);
    console.log(`║  ✓ Passed (2xx/3xx): ${String(report.summary.totalPassed).padEnd(38)}║`);
    console.log(`║  ✗ Failed:           ${String(report.summary.totalFailed).padEnd(38)}║`);
    console.log(`║  ⚠ Rate Limited 429: ${String(report.summary.totalRateLimited).padEnd(38)}║`);
    console.log(`║  Pass Rate:          ${report.summary.overallPassRate.padEnd(38)}║`);
    console.log(`║  Total Time:         ${totalTime.padEnd(37)}s║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ${report.summary.verdict.padEnd(58)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    return report;
  }
}

// ──────── Entry Point ───────────────────────────────────────────────────────────
const runner = new LoadTestRunner();
runner.run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Load test runner crashed:', err);
  process.exit(1);
});
