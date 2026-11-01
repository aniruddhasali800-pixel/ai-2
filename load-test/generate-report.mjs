/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Sizzle Load Test — HTML Report Generator
 *  Reads load-test-report.json and produces a stunning visual dashboard
 * ═══════════════════════════════════════════════════════════════════════
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(__dirname, 'load-test-report.json');
const outputPath = path.join(__dirname, 'report.html');

if (!fs.existsSync(reportPath)) {
  console.error('❌ No report found. Run the load test first: node load-test.js');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

function statusColor(rate) {
  const num = parseFloat(rate);
  if (num >= 95) return '#00e676';
  if (num >= 80) return '#ffc107';
  return '#ff5252';
}

function testCard(name, data) {
  if (!data || data.total === 0) {
    return `
      <div class="test-card skipped">
        <h3>${formatName(name)}</h3>
        <p class="description">${data?.description || 'Test was skipped'}</p>
        <div class="badge skip-badge">SKIPPED</div>
      </div>
    `;
  }

  const passRate = parseFloat(data.passRate || '0');
  const color = statusColor(passRate);
  const badge = passRate >= 95 ? 'PASS' : passRate >= 70 ? 'WARN' : 'FAIL';
  const badgeClass = passRate >= 95 ? 'pass-badge' : passRate >= 70 ? 'warn-badge' : 'fail-badge';

  let endpointBreakdown = '';
  const breakdown = data.byEndpoint || data.byOperation;
  if (breakdown) {
    endpointBreakdown = `
      <div class="breakdown">
        <h4>Endpoint Breakdown</h4>
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Total</th>
              <th>Pass</th>
              <th>Fail</th>
              <th>Avg</th>
              <th>P95</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(breakdown).map(([ep, stats]) => `
              <tr>
                <td class="ep-name">${ep}</td>
                <td>${stats.total}</td>
                <td class="pass-cell">${stats.passed}</td>
                <td class="fail-cell">${stats.failed}</td>
                <td>${stats.avgLatency}</td>
                <td>${stats.p95}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  let rateLimitInfo = '';
  if (data.rateLimitTriggered !== undefined) {
    rateLimitInfo = `
      <div class="rate-limit-box ${data.rateLimitTriggered ? 'triggered' : 'not-triggered'}">
        <span class="rl-icon">${data.rateLimitTriggered ? '🛡️' : '⚠️'}</span>
        <span>${data.detectedAt}</span>
      </div>
    `;
  }

  let statusCodes = '';
  if (data.statusCodes) {
    statusCodes = `
      <div class="status-codes">
        ${Object.entries(data.statusCodes).map(([code, count]) => `
          <span class="sc-chip sc-${code[0]}">${code}: ${count}</span>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="test-card">
      <div class="card-header">
        <h3>${formatName(name)}</h3>
        <div class="badge ${badgeClass}">${badge}</div>
      </div>
      <p class="description">${data.description}</p>
      ${rateLimitInfo}
      <div class="metrics-grid">
        <div class="metric">
          <span class="metric-value">${data.total}</span>
          <span class="metric-label">Requests</span>
        </div>
        <div class="metric">
          <span class="metric-value" style="color: #00e676">${data.passed}</span>
          <span class="metric-label">Passed</span>
        </div>
        <div class="metric">
          <span class="metric-value" style="color: ${data.failed > 0 ? '#ff5252' : '#888'}">${data.failed}</span>
          <span class="metric-label">Failed</span>
        </div>
        <div class="metric">
          <span class="metric-value" style="color: ${(data.rateLimited || 0) > 0 ? '#ffc107' : '#888'}">${data.rateLimited || 0}</span>
          <span class="metric-label">Rate Limited</span>
        </div>
      </div>
      <div class="latency-bar">
        <div class="latency-item">
          <span class="lat-label">Avg</span>
          <span class="lat-value">${data.avgLatency || '—'}</span>
        </div>
        <div class="latency-item">
          <span class="lat-label">P50</span>
          <span class="lat-value">${data.p50 || '—'}</span>
        </div>
        <div class="latency-item">
          <span class="lat-label">P90</span>
          <span class="lat-value">${data.p90 || '—'}</span>
        </div>
        <div class="latency-item">
          <span class="lat-label">P95</span>
          <span class="lat-value">${data.p95 || '—'}</span>
        </div>
        <div class="latency-item">
          <span class="lat-label">P99</span>
          <span class="lat-value">${data.p99 || '—'}</span>
        </div>
        <div class="latency-item">
          <span class="lat-label">Max</span>
          <span class="lat-value">${data.maxLatency || '—'}</span>
        </div>
      </div>
      ${statusCodes}
      ${endpointBreakdown}
    </div>
  `;
}

function formatName(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

const verdictEmoji = report.summary.verdict.startsWith('✅') ? '✅'
  : report.summary.verdict.startsWith('⚠') ? '⚠️' : '❌';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sizzle Load Test Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-deep: #0a0a0f;
      --bg-card: #12121a;
      --bg-surface: #1a1a2e;
      --bg-glass: rgba(255,255,255,0.03);
      --border: rgba(255,255,255,0.06);
      --border-glow: rgba(99, 102, 241, 0.3);
      --text-primary: #f0f0f5;
      --text-secondary: #8888aa;
      --text-muted: #555570;
      --accent-green: #00e676;
      --accent-red: #ff5252;
      --accent-amber: #ffc107;
      --accent-blue: #6366f1;
      --accent-cyan: #22d3ee;
      --accent-purple: #a855f7;
      --gradient-hero: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --gradient-card: linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.04) 100%);
      --shadow-xl: 0 25px 50px -12px rgba(0,0,0,0.5);
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-deep);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.6;
    }

    /* ── HERO ── */
    .hero {
      position: relative;
      overflow: hidden;
      padding: 60px 24px 48px;
      background: linear-gradient(180deg, #0f0f1a 0%, var(--bg-deep) 100%);
    }
    .hero::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -20%;
      width: 140%;
      height: 200%;
      background: radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.12) 0%, transparent 50%),
                  radial-gradient(ellipse at 70% 60%, rgba(168,85,247,0.08) 0%, transparent 50%);
      pointer-events: none;
    }
    .hero-inner {
      max-width: 1200px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 100px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      color: #818cf8;
      margin-bottom: 20px;
    }
    .hero h1 {
      font-size: clamp(28px, 5vw, 48px);
      font-weight: 900;
      letter-spacing: -1.5px;
      background: linear-gradient(135deg, #fff 30%, #818cf8 70%, #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .hero .subtitle {
      font-size: 15px;
      color: var(--text-secondary);
      max-width: 600px;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin-top: 24px;
    }
    .meta-item {
      font-size: 13px;
      color: var(--text-muted);
    }
    .meta-item strong {
      color: var(--text-secondary);
      font-weight: 500;
    }

    /* ── SUMMARY ── */
    .summary-strip {
      max-width: 1200px;
      margin: -24px auto 32px;
      padding: 0 24px;
      position: relative;
      z-index: 2;
    }
    .summary-card {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1px;
      background: var(--border);
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--border);
      box-shadow: var(--shadow-xl);
    }
    .sum-cell {
      background: var(--bg-card);
      padding: 24px;
      text-align: center;
    }
    .sum-cell:first-child { border-radius: 16px 0 0 16px; }
    .sum-cell:last-child { border-radius: 0 16px 16px 0; }
    .sum-value {
      display: block;
      font-size: 32px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      line-height: 1.2;
    }
    .sum-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .verdict-banner {
      max-width: 1200px;
      margin: 0 auto 40px;
      padding: 0 24px;
    }
    .verdict-inner {
      padding: 20px 28px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      text-align: center;
      letter-spacing: 0.3px;
    }
    .verdict-pass { background: rgba(0,230,118,0.08); border: 1px solid rgba(0,230,118,0.2); color: #00e676; }
    .verdict-warn { background: rgba(255,193,7,0.08); border: 1px solid rgba(255,193,7,0.2); color: #ffc107; }
    .verdict-fail { background: rgba(255,82,82,0.08); border: 1px solid rgba(255,82,82,0.2); color: #ff5252; }

    /* ── TEST CARDS ── */
    .tests-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px 80px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 24px;
    }
    @media (max-width: 600px) {
      .tests-container { grid-template-columns: 1fr; }
    }
    .test-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      transition: border-color 0.3s, box-shadow 0.3s;
    }
    .test-card:hover {
      border-color: var(--border-glow);
      box-shadow: 0 0 40px rgba(99,102,241,0.06);
    }
    .test-card.skipped {
      opacity: 0.5;
      border-style: dashed;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .test-card h3 {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .description {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .badge {
      padding: 4px 12px;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .pass-badge { background: rgba(0,230,118,0.12); color: #00e676; border: 1px solid rgba(0,230,118,0.3); }
    .warn-badge { background: rgba(255,193,7,0.12); color: #ffc107; border: 1px solid rgba(255,193,7,0.3); }
    .fail-badge { background: rgba(255,82,82,0.12); color: #ff5252; border: 1px solid rgba(255,82,82,0.3); }
    .skip-badge { background: rgba(136,136,170,0.12); color: #888; border: 1px solid rgba(136,136,170,0.3); }

    .rate-limit-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .rate-limit-box.triggered {
      background: rgba(0,230,118,0.06);
      border: 1px solid rgba(0,230,118,0.15);
      color: var(--accent-green);
    }
    .rate-limit-box.not-triggered {
      background: rgba(255,193,7,0.06);
      border: 1px solid rgba(255,193,7,0.15);
      color: var(--accent-amber);
    }
    .rl-icon { font-size: 18px; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric {
      text-align: center;
      padding: 12px 4px;
      border-radius: 10px;
      background: var(--bg-glass);
      border: 1px solid var(--border);
    }
    .metric-value {
      display: block;
      font-size: 22px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
    }
    .metric-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
    }

    .latency-bar {
      display: flex;
      gap: 1px;
      border-radius: 10px;
      overflow: hidden;
      background: var(--border);
      margin-bottom: 16px;
    }
    .latency-item {
      flex: 1;
      background: var(--bg-surface);
      padding: 10px 4px;
      text-align: center;
    }
    .lat-label {
      display: block;
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }
    .lat-value {
      display: block;
      font-size: 13px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      color: var(--accent-cyan);
      margin-top: 2px;
    }

    .status-codes {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
    }
    .sc-chip {
      padding: 3px 10px;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .sc-2 { background: rgba(0,230,118,0.1); color: #00e676; }
    .sc-3 { background: rgba(34,211,238,0.1); color: #22d3ee; }
    .sc-4 { background: rgba(255,193,7,0.1); color: #ffc107; }
    .sc-5 { background: rgba(255,82,82,0.1); color: #ff5252; }
    .sc-0 { background: rgba(136,136,170,0.1); color: #888; }

    .breakdown {
      margin-top: 16px;
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }
    .breakdown h4 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }
    .breakdown table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .breakdown th {
      text-align: left;
      padding: 6px 8px;
      font-weight: 600;
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      border-bottom: 1px solid var(--border);
    }
    .breakdown td {
      padding: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.02);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    .ep-name {
      font-family: 'Inter', sans-serif !important;
      font-weight: 500;
      color: var(--text-secondary);
    }
    .pass-cell { color: var(--accent-green); }
    .fail-cell { color: var(--accent-red); }
    .breakdown tr:hover td { background: rgba(255,255,255,0.015); }

    /* ── FOOTER ── */
    .footer {
      text-align: center;
      padding: 32px 24px;
      font-size: 12px;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      max-width: 1200px;
      margin: 0 auto;
    }
    .footer a { color: var(--accent-blue); text-decoration: none; }

    /* ── ANIMATIONS ── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .test-card {
      animation: fadeUp 0.5s ease-out both;
    }
    .test-card:nth-child(1) { animation-delay: 0.05s; }
    .test-card:nth-child(2) { animation-delay: 0.1s; }
    .test-card:nth-child(3) { animation-delay: 0.15s; }
    .test-card:nth-child(4) { animation-delay: 0.2s; }
    .test-card:nth-child(5) { animation-delay: 0.25s; }
    .test-card:nth-child(6) { animation-delay: 0.3s; }
    .test-card:nth-child(7) { animation-delay: 0.35s; }
    .test-card:nth-child(8) { animation-delay: 0.4s; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="hero-inner">
      <div class="hero-badge">🔥 Load Test Report</div>
      <h1>Sizzle Restaurant API</h1>
      <p class="subtitle">Performance & rate-limiting analysis across all service endpoints — waiters, cashiers, kitchen, and customer flows.</p>
      <div class="meta-row">
        <span class="meta-item"><strong>Target:</strong> ${report.meta.baseUrl}</span>
        <span class="meta-item"><strong>Time:</strong> ${new Date(report.meta.timestamp).toLocaleString()}</span>
        <span class="meta-item"><strong>Duration:</strong> ${report.meta.totalDuration || '—'}</span>
        <span class="meta-item"><strong>Node:</strong> ${report.meta.nodeVersion}</span>
      </div>
    </div>
  </div>

  <div class="summary-strip">
    <div class="summary-card">
      <div class="sum-cell">
        <span class="sum-value" style="color: var(--accent-blue)">${report.summary.totalRequests}</span>
        <span class="sum-label">Total Requests</span>
      </div>
      <div class="sum-cell">
        <span class="sum-value" style="color: var(--accent-green)">${report.summary.totalPassed}</span>
        <span class="sum-label">Passed</span>
      </div>
      <div class="sum-cell">
        <span class="sum-value" style="color: var(--accent-red)">${report.summary.totalFailed}</span>
        <span class="sum-label">Failed</span>
      </div>
      <div class="sum-cell">
        <span class="sum-value" style="color: var(--accent-amber)">${report.summary.totalRateLimited}</span>
        <span class="sum-label">Rate Limited</span>
      </div>
      <div class="sum-cell">
        <span class="sum-value" style="color: ${statusColor(parseFloat(report.summary.overallPassRate))}">${report.summary.overallPassRate}</span>
        <span class="sum-label">Pass Rate</span>
      </div>
    </div>
  </div>

  <div class="verdict-banner">
    <div class="verdict-inner ${report.summary.verdict.startsWith('✅') ? 'verdict-pass' : report.summary.verdict.startsWith('⚠') ? 'verdict-warn' : 'verdict-fail'}">
      ${report.summary.verdict}
    </div>
  </div>

  <div class="tests-container">
    ${Object.entries(report.tests).map(([name, data]) => testCard(name, data)).join('')}
  </div>

  <div class="footer">
    Generated by <a href="#">Sizzle Load Test Tool v1.0</a> · ${new Date(report.meta.timestamp).toLocaleString()}
  </div>
</body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(`✅ HTML report generated: ${outputPath}`);
