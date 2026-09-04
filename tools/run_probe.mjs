/*
 * Playwright runner for tools/browser_capability_probe.js
 * Run on a machine that can reach the target (this cloud sandbox cannot reach karrot.evenit.co.kr).
 *
 *   npm i playwright && npx playwright install chromium
 *   node tools/run_probe.mjs https://karrot.evenit.co.kr/ --out reports/karrot
 *   node tools/run_probe.mjs https://karrot.evenit.co.kr/ --headed --storage-state auth.json
 *   node tools/run_probe.mjs https://karrot.evenit.co.kr/ --save-state auth.json --headed   (login manually, then press Enter)
 *
 * Output: <out>/report.json, <out>/screenshot.png, <out>/console.log
 * Cookie values are redacted. No clicks, no form submits, no navigation beyond the URL given.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const CONFIG = {
  viewport: { width: 1366, height: 900 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  navigationTimeoutMs: 45000,
  settleMs: 2500,
  probePath: resolve(dirname(fileURLToPath(import.meta.url)), 'browser_capability_probe.js'),
  interestingHeaders: [
    'content-security-policy', 'content-security-policy-report-only', 'x-frame-options',
    'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy',
    'access-control-allow-origin', 'strict-transport-security', 'set-cookie', 'server', 'x-powered-by', 'cache-control'
  ]
};

function parseArgs(argv) {
  const a = { url: null, out: 'reports/probe', headed: false, storageState: null, saveState: null, executablePath: process.env.PROBE_CHROMIUM || null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--out') a.out = argv[++i];
    else if (v === '--headed') a.headed = true;
    else if (v === '--storage-state') a.storageState = argv[++i];
    else if (v === '--save-state') a.saveState = argv[++i];
    else if (v === '--executable') a.executablePath = argv[++i];
    else if (!a.url) a.url = v;
  }
  if (!a.url) { console.error('usage: node tools/run_probe.mjs <url> [--out dir] [--headed] [--storage-state file] [--save-state file] [--executable path]'); process.exit(2); }
  return a;
}

function waitForEnter(msg) {
  return new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(msg, () => { rl.close(); res(); }); });
}

function redactCookies(cookies) {
  return cookies.map(c => ({ name: c.name, domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, expires: c.expires, valueLength: (c.value || '').length }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const probeSource = readFileSync(CONFIG.probePath, 'utf8');
  const consoleLines = [];
  const requests = [];
  const failures = [];
  let mainResponse = null;

  const browser = await chromium.launch({ headless: !args.headed, executablePath: args.executablePath || undefined });
  const context = await browser.newContext({
    viewport: CONFIG.viewport, locale: CONFIG.locale, timezoneId: CONFIG.timezoneId,
    storageState: args.storageState ? resolve(args.storageState) : undefined
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(CONFIG.navigationTimeoutMs);

  page.on('console', m => consoleLines.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => consoleLines.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => failures.push({ url: r.url(), method: r.method(), error: r.failure() && r.failure().errorText }));
  page.on('response', r => {
    const req = r.request();
    requests.push({ url: r.url(), status: r.status(), type: req.resourceType(), method: req.method() });
  });

  const startedAt = new Date().toISOString();
  let navError = null;
  try {
    mainResponse = await page.goto(args.url, { waitUntil: 'load' });
  } catch (e) { navError = e.message; }

  if (args.saveState) {
    await waitForEnter('Log in inside the browser window, then press Enter to save storage state... ');
  }
  await page.waitForTimeout(CONFIG.settleMs);

  let probe = null; let probeError = null;
  try { probe = await page.evaluate(probeSource); } catch (e) { probeError = e.message; }

  let headers = {};
  if (mainResponse) {
    const all = await mainResponse.allHeaders();
    for (const k of CONFIG.interestingHeaders) if (all[k] != null) headers[k] = k === 'set-cookie' ? '(present, redacted)' : all[k];
  }

  const cookies = redactCookies(await context.cookies());
  const hostCounts = requests.reduce((m, r) => { let h; try { h = new URL(r.url).host; } catch { h = '?'; } m[h] = (m[h] || 0) + 1; return m; }, {});

  const report = {
    runner: 'run_probe.mjs/1.0.0', startedAt, finishedAt: new Date().toISOString(), url: args.url, finalUrl: page.url(),
    navigation: { status: mainResponse ? mainResponse.status() : null, error: navError, redirected: mainResponse ? mainResponse.url() !== args.url : null },
    responseHeaders: headers,
    cookies, requestsByHost: hostCounts, requestFailures: failures,
    consoleErrorCount: consoleLines.filter(l => l.startsWith('[error]') || l.startsWith('[pageerror]')).length,
    probeError, probe
  };

  try { await page.screenshot({ path: resolve(outDir, 'screenshot.png'), fullPage: true }); } catch (e) { report.screenshotError = e.message; }
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(outDir, 'console.log'), consoleLines.join('\n'));
  if (args.saveState) await context.storageState({ path: resolve(args.saveState) });
  await browser.close();

  const s = probe ? probe.summary : {};
  console.log('URL      :', report.finalUrl);
  console.log('HTTP     :', report.navigation.status, navError ? '(' + navError + ')' : '');
  console.log('Probe    :', probeError ? 'FAILED ' + probeError : JSON.stringify(s));
  console.log('Headers  :', Object.keys(headers).join(', ') || '(none of interest)');
  console.log('Cookies  :', cookies.length, '(httpOnly=' + cookies.filter(c => c.httpOnly).length + ')');
  console.log('Output   :', outDir);
  if (probe) {
    const bad = probe.rows.filter(r => r.status === 'blocked');
    if (bad.length) { console.log('Blocked  :'); for (const r of bad) console.log('  -', r.label, '=>', r.detail); }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
