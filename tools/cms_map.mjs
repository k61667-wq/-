/*
 * CMS logged-in mapper (read-only).
 * Captures each given path's DOM controls + all XHR/fetch API calls the app fires,
 * so automation can be designed against real screens and endpoints.
 * It NAVIGATES to given URLs only. It does NOT click, submit, or mutate anything.
 *
 * One-time login capture:
 *   node tools/cms_map.mjs https://karrot.evenit.co.kr/ --save-state auth.json --headed
 *   (log in inside the window, then press Enter)
 *
 * Map screens (reuses saved login):
 *   node tools/cms_map.mjs https://karrot.evenit.co.kr/ --storage-state auth.json \
 *        --paths / /dashboard /posts --out reports/cms_map
 *
 * Output per path: <out>/<n>_<slug>.png + <out>/map.json
 * Request/response bodies are NOT recorded. auth.json holds session cookies — never commit.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

function parseArgs(argv) {
  const a = { base: null, out: 'reports/cms_map', headed: false, storageState: null, saveState: null, paths: ['/'], settleMs: 3000, executablePath: process.env.PROBE_CHROMIUM || null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--out') a.out = argv[++i];
    else if (v === '--headed') a.headed = true;
    else if (v === '--storage-state') a.storageState = argv[++i];
    else if (v === '--save-state') a.saveState = argv[++i];
    else if (v === '--executable') a.executablePath = argv[++i];
    else if (v === '--settle') a.settleMs = +argv[++i];
    else if (v === '--paths') { a.paths = []; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a.paths.push(argv[++i]); }
    else if (!a.base) a.base = v;
  }
  if (!a.base) { console.error('usage: node tools/cms_map.mjs <baseUrl> [--save-state f | --storage-state f] [--paths / /a /b] [--headed] [--out dir]'); process.exit(2); }
  return a;
}
const waitEnter = (m) => new Promise((r) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(m, () => { rl.close(); r(); }); });
const slug = (p) => (p.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root');
const hostOf = (u) => { try { return new URL(u).host; } catch { return '?'; } };

const CONTROLS = `() => {
  const t = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  const sel = (el) => { const id = el.id ? '#' + el.id : ''; const nm = el.name ? '[name=' + el.name + ']' : ''; const dt = el.getAttribute('data-testid') ? '[data-testid=' + el.getAttribute('data-testid') + ']' : ''; return (el.tagName.toLowerCase() + id + nm + dt); };
  const uniq = (arr) => [...new Map(arr.map(x => [JSON.stringify(x), x])).values()];
  return {
    title: document.title,
    headings: uniq([...document.querySelectorAll('h1,h2,h3')].map(h => t(h)).filter(Boolean)).slice(0, 30),
    navLinks: uniq([...document.querySelectorAll('a[href]')].map(a => ({ text: t(a), href: a.getAttribute('href') })).filter(x => x.href && !x.href.startsWith('javascript'))).slice(0, 80),
    buttons: uniq([...document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')].map(b => ({ text: t(b), sel: sel(b) })).filter(x => x.text)).slice(0, 80),
    forms: [...document.forms].map(f => ({ action: f.getAttribute('action') || '(js)', method: (f.method || 'get').toUpperCase(), fields: [...f.elements].filter(e => e.name || e.id).map(e => ({ tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name || e.id, required: !!e.required, sel: sel(e) })) })),
    inputsOutsideForm: uniq([...document.querySelectorAll('input,select,textarea')].filter(e => !e.form).map(e => ({ type: e.type || e.tagName.toLowerCase(), name: e.name || e.id || '', placeholder: e.placeholder || '', sel: sel(e) }))).slice(0, 60),
    tables: [...document.querySelectorAll('table')].map(tb => ({ rows: tb.rows.length, headers: [...tb.querySelectorAll('th')].map(th => t(th)).slice(0, 20) })),
    counts: { elements: document.getElementsByTagName('*').length, links: document.links.length, buttons: document.querySelectorAll('button').length, inputs: document.querySelectorAll('input,select,textarea').length }
  };
}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out); mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: !args.headed, executablePath: args.executablePath || undefined });
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 960 }, storageState: args.storageState ? resolve(args.storageState) : undefined });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(45000);

  const api = [];
  page.on('requestfinished', async (req) => {
    const rt = req.resourceType();
    if (rt !== 'xhr' && rt !== 'fetch') return;
    let status = null; try { const r = await req.response(); status = r && r.status(); } catch {}
    let u; try { u = new URL(req.url()); } catch { return; }
    api.push({ method: req.method(), host: u.host, path: u.pathname + (u.search ? '?…' : ''), status });
  });

  if (args.saveState) {
    await page.goto(args.base, { waitUntil: 'load' });
    await waitEnter('Log in inside the browser window, then press Enter to save session... ');
    await context.storageState({ path: resolve(args.saveState) });
    console.log('Saved session ->', resolve(args.saveState));
  }

  const screens = [];
  for (let i = 0; i < args.paths.length; i++) {
    const p = args.paths[i];
    const url = new URL(p, args.base).href;
    api.length = 0;
    let nav = null, err = null;
    try { const resp = await page.goto(url, { waitUntil: 'networkidle' }); nav = resp && resp.status(); } catch (e) { err = e.message; }
    await page.waitForTimeout(args.settleMs);
    let controls = null; try { controls = await page.evaluate('(' + CONTROLS + ')()'); } catch (e) { controls = { error: e.message }; }
    const shot = `${i}_${slug(p)}.png`;
    try { await page.screenshot({ path: resolve(outDir, shot), fullPage: true }); } catch {}
    const apiSnapshot = [...new Map(api.map(a => [a.method + a.host + a.path, a])).values()];
    screens.push({ path: p, finalUrl: page.url(), nav, err, screenshot: shot, controls, api: apiSnapshot });
    console.log(`[${i}] ${p} -> ${page.url()} (${nav}) | ${(controls.counts && controls.counts.elements) || '?'} els | ${apiSnapshot.length} api`);
  }

  const map = { mappedAt: new Date().toISOString(), base: args.base, apiHosts: [...new Set(screens.flatMap(s => s.api.map(a => a.host)))], screens };
  writeFileSync(resolve(outDir, 'map.json'), JSON.stringify(map, null, 2));
  console.log('Output ->', outDir, '(map.json + screenshots)');
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
