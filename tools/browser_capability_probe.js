/*
 * Browser Capability Probe (read-only)
 * Usage A: paste whole file into DevTools Console on the target page.
 * Usage B: injected by tools/run_probe.mjs via page.evaluate().
 * Result: console.table + window.__BROWSER_PROBE_RESULT__ (JSON serializable).
 * Safety: no navigation, no form submit, no clicks, no writes except a
 *         self-removed test key in Web Storage / IndexedDB / CacheStorage.
 */
(async () => {
  const CONFIG = {
    crossOriginTestUrl: null, // e.g. "https://api.example.com/health" (must allow CORS). null = skip
    sameOriginFetch: true,
    storageWriteTest: true,
    indexedDbTest: true,
    cacheStorageTest: true,
    serviceWorkerLookup: true,
    permissionNames: [
      'geolocation', 'notifications', 'camera', 'microphone',
      'clipboard-read', 'clipboard-write', 'persistent-storage'
    ],
    knownGlobals: [
      'React', 'ReactDOM', '__REACT_DEVTOOLS_GLOBAL_HOOK__', '__NEXT_DATA__', 'next',
      '__NUXT__', 'Vue', '__VUE__', 'angular', 'ng', 'jQuery', '$', '_', 'axios',
      'firebase', 'supabase', 'gtag', 'dataLayer', 'ga', 'fbq', 'kakao', 'Kakao',
      'naver', 'ChannelIO', 'Sentry', '__SVELTE__', 'Alpine', 'htmx', 'Vite', 'webpackChunk'
    ],
    listGlobalsMaxDetail: 40
  };

  const rows = [];
  const add = (category, id, label, status, detail) => {
    rows.push({ category, id, label, status, detail: detail == null ? '' : String(detail).slice(0, 300) });
  };
  const STATUS = { OK: 'ok', BLOCKED: 'blocked', NA: 'unavailable', SKIP: 'skipped', INFO: 'info' };
  const has = (obj, key) => { try { return obj != null && key in obj; } catch (e) { return false; } };
  const safe = async (category, id, label, fn) => {
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'status' in r) add(category, id, label, r.status, r.detail);
      else add(category, id, label, STATUS.OK, r);
    } catch (e) {
      const name = e && e.name ? e.name : 'Error';
      const msg = e && e.message ? e.message : String(e);
      const blocked = /SecurityError|NotAllowedError|CSP|Content Security Policy|cross-origin|Blocked|denied/i.test(name + ' ' + msg);
      add(category, id, label, blocked ? STATUS.BLOCKED : STATUS.NA, name + ': ' + msg);
    }
  };
  const hostOf = (u) => { try { return new URL(u, location.href).host; } catch (e) { return '(invalid)'; } };
  const countBy = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const fmtCounts = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '(' + v + ')').join(', ');

  // 1. Environment
  await safe('env', 'env.url', 'location', () => location.href);
  await safe('env', 'env.origin', 'origin', () => location.origin);
  await safe('env', 'env.ua', 'userAgent', () => navigator.userAgent);
  await safe('env', 'env.secure', 'isSecureContext', () => ({ status: window.isSecureContext ? STATUS.OK : STATUS.BLOCKED, detail: String(window.isSecureContext) }));
  await safe('env', 'env.coi', 'crossOriginIsolated', () => ({ status: STATUS.INFO, detail: String(window.crossOriginIsolated) }));
  await safe('env', 'env.framed', 'running inside iframe', () => ({ status: STATUS.INFO, detail: window.top === window.self ? 'top-level' : 'framed' }));
  await safe('env', 'env.viewport', 'viewport / DPR', () => innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio + ' screen ' + screen.width + 'x' + screen.height);
  await safe('env', 'env.lang', 'language / online / visibility', () => navigator.language + ' / online=' + navigator.onLine + ' / ' + document.visibilityState);
  await safe('env', 'env.cookiesEnabled', 'navigator.cookieEnabled', () => String(navigator.cookieEnabled));
  await safe('env', 'env.webdriver', 'navigator.webdriver (automation flag)', () => ({ status: STATUS.INFO, detail: String(navigator.webdriver) }));

  // 2. DOM
  await safe('dom', 'dom.ready', 'document.readyState', () => document.readyState);
  await safe('dom', 'dom.title', 'document.title', () => document.title);
  await safe('dom', 'dom.count', 'element count', () => document.getElementsByTagName('*').length);
  await safe('dom', 'dom.forms', 'forms / inputs / buttons / links', () =>
    document.forms.length + ' / ' + document.querySelectorAll('input,select,textarea').length + ' / ' +
    document.querySelectorAll('button,[role=button],input[type=submit]').length + ' / ' + document.links.length);
  await safe('dom', 'dom.inputs', 'input types present', () => fmtCounts(countBy([...document.querySelectorAll('input')].map(i => i.type))) || '(none)');
  await safe('dom', 'dom.contenteditable', 'contenteditable elements', () => document.querySelectorAll('[contenteditable]:not([contenteditable=false])').length);
  await safe('dom', 'dom.shadow', 'shadow roots (open)', () => [...document.querySelectorAll('*')].filter(e => e.shadowRoot).length);
  await safe('dom', 'dom.customElements', 'customElements registry', () => ({ status: has(window, 'customElements') ? STATUS.OK : STATUS.NA, detail: fmtCounts(countBy([...document.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(t => t.includes('-')))) || '(none defined in DOM)' }));
  await safe('dom', 'dom.iframes', 'iframes (same-origin access)', () => {
    const frames = [...document.querySelectorAll('iframe')];
    if (!frames.length) return '(none)';
    return frames.map(f => {
      let acc;
      try { acc = f.contentDocument ? 'accessible' : 'blocked'; } catch (e) { acc = 'blocked'; }
      return (f.src ? hostOf(f.src) : 'about:blank') + ':' + acc;
    }).join(', ');
  });
  await safe('dom', 'dom.mutate', 'create/append/remove element', () => {
    const el = document.createElement('div'); el.setAttribute('data-probe', '1'); el.style.display = 'none';
    document.body.appendChild(el); const ok = !!document.querySelector('[data-probe="1"]'); el.remove(); return ok ? 'ok' : { status: STATUS.BLOCKED, detail: 'append failed' };
  });
  await safe('dom', 'dom.innerHTML', 'innerHTML assignment (Trusted Types check)', () => {
    const el = document.createElement('div'); el.innerHTML = '<b>x</b>'; return el.firstChild && el.firstChild.tagName === 'B' ? 'allowed' : { status: STATUS.BLOCKED, detail: 'sanitized' };
  });
  await safe('dom', 'dom.mo', 'MutationObserver', () => new Promise((res) => {
    const target = document.createElement('div'); document.body.appendChild(target);
    const mo = new MutationObserver(() => { mo.disconnect(); target.remove(); res('fires'); });
    mo.observe(target, { attributes: true }); target.setAttribute('data-x', '1');
    setTimeout(() => { mo.disconnect(); target.remove(); res({ status: STATUS.NA, detail: 'no callback within 500ms' }); }, 500);
  }));
  await safe('dom', 'dom.observers', 'ResizeObserver / IntersectionObserver', () => (has(window, 'ResizeObserver') ? 'RO ' : 'noRO ') + (has(window, 'IntersectionObserver') ? 'IO' : 'noIO'));
  await safe('dom', 'dom.events', 'synthetic event dispatch (isTrusted=false)', () => new Promise((res) => {
    const el = document.createElement('button'); let got = null;
    el.addEventListener('click', (e) => { got = e; }); el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    res(got ? 'dispatched, isTrusted=' + got.isTrusted : { status: STATUS.NA, detail: 'listener not called' });
  }));
  await safe('dom', 'dom.execCommand', 'document.execCommand available', () => ({ status: STATUS.INFO, detail: typeof document.execCommand === 'function' ? 'present (deprecated)' : 'absent' }));

  // 3. Script execution / CSP
  await safe('csp', 'csp.meta', 'CSP <meta> tags', () => {
    const m = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')];
    return { status: STATUS.INFO, detail: m.length ? m.map(x => x.content).join(' | ') : '(none; header-based CSP not visible from JS)' };
  });
  await safe('csp', 'csp.eval', 'eval() [console/CDP-injected code is CSP-exempt; page scripts may still be blocked]', () => { const v = (0, eval)('1+1'); return v === 2 ? 'allowed in this context' : { status: STATUS.NA, detail: String(v) }; });
  await safe('csp', 'csp.function', 'new Function() [same exemption as eval]', () => new Function('return 3')() === 3 ? 'allowed in this context' : { status: STATUS.NA, detail: 'unexpected' });
  await safe('csp', 'csp.inlineScript', 'inline <script> injection', () => new Promise((res) => {
    const k = '__probe_inline_' + Date.now(); const s = document.createElement('script');
    s.textContent = 'window["' + k + '"]=true';
    s.addEventListener('error', () => { s.remove(); res({ status: STATUS.BLOCKED, detail: 'script error event' }); });
    document.head.appendChild(s);
    setTimeout(() => { const ok = window[k] === true; delete window[k]; s.remove(); res(ok ? 'allowed' : { status: STATUS.BLOCKED, detail: 'not executed (CSP script-src?)' }); }, 50);
  }));
  await safe('csp', 'csp.blobWorker', 'Worker from blob: URL', () => new Promise((res) => {
    const url = URL.createObjectURL(new Blob(['postMessage(42)'], { type: 'text/javascript' }));
    let w; try { w = new Worker(url); } catch (e) { URL.revokeObjectURL(url); return res({ status: STATUS.BLOCKED, detail: e.message }); }
    const t = setTimeout(() => { w.terminate(); URL.revokeObjectURL(url); res({ status: STATUS.BLOCKED, detail: 'no message (worker-src?)' }); }, 800);
    w.onmessage = () => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); res('allowed'); };
    w.onerror = (e) => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); res({ status: STATUS.BLOCKED, detail: e.message || 'error' }); };
  }));
  await safe('csp', 'csp.trustedTypes', 'Trusted Types', () => ({ status: STATUS.INFO, detail: has(window, 'trustedTypes') ? 'API present' : 'absent' }));
  await safe('csp', 'csp.wasm', 'WebAssembly', () => has(window, 'WebAssembly') ? 'present' : { status: STATUS.NA, detail: 'absent' });

  // 4. Storage
  await safe('storage', 'storage.ls', 'localStorage read/write', () => {
    const n = localStorage.length;
    if (!CONFIG.storageWriteTest) return { status: STATUS.SKIP, detail: 'keys=' + n };
    const k = '__probe_' + Date.now(); localStorage.setItem(k, '1'); const ok = localStorage.getItem(k) === '1'; localStorage.removeItem(k);
    return ok ? 'rw ok, existing keys=' + n : { status: STATUS.BLOCKED, detail: 'write failed' };
  });
  await safe('storage', 'storage.ss', 'sessionStorage read/write', () => {
    const n = sessionStorage.length; const k = '__probe_' + Date.now(); sessionStorage.setItem(k, '1'); const ok = sessionStorage.getItem(k) === '1'; sessionStorage.removeItem(k);
    return ok ? 'rw ok, existing keys=' + n : { status: STATUS.BLOCKED, detail: 'write failed' };
  });
  await safe('storage', 'storage.cookie', 'document.cookie (non-HttpOnly only)', () => {
    const c = document.cookie ? document.cookie.split(';').map(s => s.trim().split('=')[0]) : [];
    return { status: STATUS.INFO, detail: 'visible names=' + c.length + (c.length ? ': ' + c.join(',') : '') + ' (HttpOnly cookies never visible)' };
  });
  await safe('storage', 'storage.cookieStore', 'CookieStore API', () => has(window, 'cookieStore') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('storage', 'storage.idb', 'IndexedDB open/delete', () => new Promise((res) => {
    if (!CONFIG.indexedDbTest || !has(window, 'indexedDB')) return res({ status: STATUS.SKIP, detail: 'skipped or absent' });
    const name = '__probe_db_' + Date.now(); const req = indexedDB.open(name, 1);
    req.onerror = () => res({ status: STATUS.BLOCKED, detail: req.error && req.error.message });
    req.onsuccess = () => { req.result.close(); const d = indexedDB.deleteDatabase(name); d.onsuccess = () => res('open+delete ok'); d.onerror = () => res({ status: STATUS.OK, detail: 'open ok, delete failed' }); };
  }));
  await safe('storage', 'storage.idbList', 'indexedDB.databases()', async () => {
    if (!indexedDB.databases) return { status: STATUS.NA, detail: 'not supported' };
    const l = await indexedDB.databases(); return 'existing=' + l.map(d => d.name).join(',');
  });
  await safe('storage', 'storage.cache', 'CacheStorage open/delete', async () => {
    if (!CONFIG.cacheStorageTest || !has(window, 'caches')) return { status: STATUS.SKIP, detail: 'skipped or absent (needs secure context)' };
    const n = '__probe_cache_' + Date.now(); await caches.open(n); const del = await caches.delete(n);
    const keys = await caches.keys(); return 'ok, delete=' + del + ', existing=' + keys.length;
  });
  await safe('storage', 'storage.estimate', 'navigator.storage.estimate()', async () => {
    if (!has(navigator, 'storage') || !navigator.storage.estimate) return { status: STATUS.NA, detail: 'absent' };
    const e = await navigator.storage.estimate(); return 'usage=' + Math.round((e.usage || 0) / 1024) + 'KB quota=' + Math.round((e.quota || 0) / 1048576) + 'MB';
  });

  // 5. Network
  await safe('net', 'net.fetchSame', 'fetch same-origin (HEAD current URL)', async () => {
    if (!CONFIG.sameOriginFetch) return { status: STATUS.SKIP, detail: 'disabled' };
    const r = await fetch(location.href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
    const h = ['content-security-policy', 'x-frame-options', 'cross-origin-opener-policy', 'access-control-allow-origin', 'server', 'x-powered-by']
      .map(k => r.headers.get(k) ? k + '=' + r.headers.get(k).slice(0, 80) : null).filter(Boolean).join(' | ');
    return 'status=' + r.status + (h ? ' | ' + h : '');
  });
  await safe('net', 'net.fetchCross', 'fetch cross-origin (CORS)', async () => {
    if (!CONFIG.crossOriginTestUrl) return { status: STATUS.SKIP, detail: 'set CONFIG.crossOriginTestUrl' };
    const r = await fetch(CONFIG.crossOriginTestUrl, { method: 'GET', mode: 'cors', cache: 'no-store' }); return 'status=' + r.status + ' type=' + r.type;
  });
  await safe('net', 'net.xhr', 'XMLHttpRequest', () => has(window, 'XMLHttpRequest') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('net', 'net.ws', 'WebSocket constructor', () => has(window, 'WebSocket') ? 'present (not connected)' : { status: STATUS.NA, detail: 'absent' });
  await safe('net', 'net.sse', 'EventSource', () => has(window, 'EventSource') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('net', 'net.beacon', 'navigator.sendBeacon', () => has(navigator, 'sendBeacon') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('net', 'net.webrtc', 'RTCPeerConnection', () => has(window, 'RTCPeerConnection') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('net', 'net.scripts', 'script hosts', () => fmtCounts(countBy([...document.scripts].filter(s => s.src).map(s => hostOf(s.src)))) || '(inline only)');
  await safe('net', 'net.styles', 'stylesheet hosts', () => fmtCounts(countBy([...document.querySelectorAll('link[rel~="stylesheet"]')].map(l => hostOf(l.href)))) || '(none)');
  await safe('net', 'net.resources', 'resource entries by host', () => {
    if (!has(window, 'performance') || !performance.getEntriesByType) return { status: STATUS.NA, detail: 'absent' };
    return fmtCounts(countBy(performance.getEntriesByType('resource').map(r => hostOf(r.name))));
  });
  await safe('net', 'net.timing', 'navigation timing (ms)', () => {
    const n = performance.getEntriesByType('navigation')[0]; if (!n) return { status: STATUS.NA, detail: 'no entry' };
    return 'ttfb=' + Math.round(n.responseStart) + ' dcl=' + Math.round(n.domContentLoadedEventEnd) + ' load=' + Math.round(n.loadEventEnd) + ' type=' + n.type;
  });

  // 6. Permissions (query only, never prompts)
  await safe('perm', 'perm.api', 'navigator.permissions', () => has(navigator, 'permissions') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  for (const name of CONFIG.permissionNames) {
    await safe('perm', 'perm.' + name, 'permission: ' + name, async () => {
      if (!has(navigator, 'permissions')) return { status: STATUS.NA, detail: 'no API' };
      const q = await navigator.permissions.query({ name });
      return { status: q.state === 'denied' ? STATUS.BLOCKED : STATUS.INFO, detail: q.state };
    });
  }
  await safe('perm', 'perm.notification', 'Notification.permission', () => ({ status: STATUS.INFO, detail: has(window, 'Notification') ? Notification.permission : 'absent' }));

  // 7. User-gesture gated APIs (availability only)
  await safe('gesture', 'gesture.clipboard', 'navigator.clipboard (write needs gesture)', () => has(navigator, 'clipboard') ? 'present: ' + ['readText', 'writeText', 'read', 'write'].filter(k => typeof navigator.clipboard[k] === 'function').join(',') : { status: STATUS.NA, detail: 'absent (insecure context?)' });
  await safe('gesture', 'gesture.fsa', 'File System Access API', () => ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'].filter(k => has(window, k)).join(',') || { status: STATUS.NA, detail: 'absent' });
  await safe('gesture', 'gesture.download', '<a download> attribute', () => 'download' in HTMLAnchorElement.prototype ? 'supported' : { status: STATUS.NA, detail: 'unsupported' });
  await safe('gesture', 'gesture.blobUrl', 'Blob + URL.createObjectURL', () => { const u = URL.createObjectURL(new Blob(['x'])); URL.revokeObjectURL(u); return 'ok'; });
  await safe('gesture', 'gesture.fullscreen', 'Fullscreen API', () => document.fullscreenEnabled ? 'enabled' : { status: STATUS.BLOCKED, detail: 'fullscreenEnabled=false' });
  await safe('gesture', 'gesture.print', 'window.print', () => typeof window.print === 'function' ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('gesture', 'gesture.share', 'navigator.share', () => has(navigator, 'share') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('gesture', 'gesture.payment', 'PaymentRequest', () => has(window, 'PaymentRequest') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('gesture', 'gesture.media', 'getUserMedia / MediaRecorder', () => (has(navigator, 'mediaDevices') && navigator.mediaDevices.getUserMedia ? 'gUM ' : 'noGUM ') + (has(window, 'MediaRecorder') ? 'MR' : 'noMR'));
  await safe('gesture', 'gesture.popup', 'window.open (not invoked)', () => typeof window.open === 'function' ? 'present; blocked without gesture' : { status: STATUS.NA, detail: 'absent' });
  await safe('gesture', 'gesture.geo', 'navigator.geolocation', () => has(navigator, 'geolocation') ? 'present (prompt required)' : { status: STATUS.NA, detail: 'absent' });

  // 8. Navigation / history
  await safe('nav', 'nav.history', 'history.replaceState (same URL)', () => { history.replaceState(history.state, '', location.href); return 'ok length=' + history.length; });
  await safe('nav', 'nav.navigation', 'Navigation API', () => has(window, 'navigation') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('nav', 'nav.bfcache', 'pageshow/pagehide support', () => 'onpageshow' in window ? 'present' : { status: STATUS.NA, detail: 'absent' });

  // 9. Workers / SW
  await safe('worker', 'worker.sw', 'ServiceWorker registrations', async () => {
    if (!has(navigator, 'serviceWorker')) return { status: STATUS.NA, detail: 'absent (insecure context?)' };
    if (!CONFIG.serviceWorkerLookup) return { status: STATUS.SKIP, detail: 'disabled' };
    const regs = await navigator.serviceWorker.getRegistrations();
    return 'registrations=' + regs.length + (regs.length ? ': ' + regs.map(r => r.scope).join(',') : '') + ' controller=' + (navigator.serviceWorker.controller ? 'yes' : 'no');
  });
  await safe('worker', 'worker.shared', 'SharedWorker', () => has(window, 'SharedWorker') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('worker', 'worker.offscreen', 'OffscreenCanvas', () => has(window, 'OffscreenCanvas') ? 'present' : { status: STATUS.NA, detail: 'absent' });

  // 10. Rendering
  await safe('render', 'render.canvas2d', 'Canvas 2D', () => document.createElement('canvas').getContext('2d') ? 'ok' : { status: STATUS.NA, detail: 'null' });
  await safe('render', 'render.webgl', 'WebGL', () => { const c = document.createElement('canvas'); return (c.getContext('webgl2') || c.getContext('webgl')) ? 'ok' : { status: STATUS.NA, detail: 'null' }; });
  await safe('render', 'render.webgpu', 'WebGPU', () => has(navigator, 'gpu') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('render', 'render.matchMedia', 'matchMedia print / dark / reduced-motion', () => 'print=' + matchMedia('print').matches + ' dark=' + matchMedia('(prefers-color-scheme: dark)').matches + ' reduced=' + matchMedia('(prefers-reduced-motion: reduce)').matches);
  await safe('render', 'render.fonts', 'document.fonts', () => has(document, 'fonts') ? 'loaded=' + document.fonts.size + ' status=' + document.fonts.status : { status: STATUS.NA, detail: 'absent' });
  await safe('render', 'render.waapi', 'Web Animations API', () => typeof Element.prototype.animate === 'function' ? 'present' : { status: STATUS.NA, detail: 'absent' });

  // 11. Crypto / misc
  await safe('misc', 'misc.subtle', 'crypto.subtle', () => has(crypto, 'subtle') ? 'present' : { status: STATUS.NA, detail: 'absent (insecure context?)' });
  await safe('misc', 'misc.uuid', 'crypto.randomUUID', () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) + '...' : { status: STATUS.NA, detail: 'absent' });
  await safe('misc', 'misc.structuredClone', 'structuredClone', () => typeof structuredClone === 'function' ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('misc', 'misc.intl', 'Intl (ko-KR)', () => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(1234567));
  await safe('misc', 'misc.bc', 'BroadcastChannel', () => has(window, 'BroadcastChannel') ? 'present' : { status: STATUS.NA, detail: 'absent' });
  await safe('misc', 'misc.locks', 'Web Locks', () => has(navigator, 'locks') ? 'present' : { status: STATUS.NA, detail: 'absent' });

  // 12. Framework / globals
  await safe('app', 'app.globals', 'known app globals present', () => CONFIG.knownGlobals.filter(g => has(window, g)).join(', ') || '(none of the known list)');
  await safe('app', 'app.markers', 'framework DOM markers', () => {
    const m = [];
    if (document.getElementById('__next')) m.push('next.js');
    if (document.getElementById('__nuxt')) m.push('nuxt');
    if (document.querySelector('[data-reactroot],[data-reactid]')) m.push('react-root');
    if (document.querySelector('[data-v-app],[data-server-rendered]')) m.push('vue');
    if (document.querySelector('[ng-version],[ng-app]')) m.push('angular');
    if (document.querySelector('[data-svelte-h],[class*="svelte-"]')) m.push('svelte');
    if (document.querySelector('script[type="module"]')) m.push('esm-scripts');
    if (document.querySelector('[data-turbo],[data-hx-get],[hx-get]')) m.push('turbo/htmx');
    return { status: STATUS.INFO, detail: m.join(', ') || '(none detected)' };
  });
  await safe('app', 'app.meta', 'generator / viewport meta', () => {
    const g = document.querySelector('meta[name=generator]'); const v = document.querySelector('meta[name=viewport]');
    return { status: STATUS.INFO, detail: 'generator=' + (g ? g.content : '-') + ' viewport=' + (v ? v.content : '-') };
  });
  await safe('app', 'app.manifest', 'web app manifest', () => { const l = document.querySelector('link[rel=manifest]'); return { status: STATUS.INFO, detail: l ? l.href : '(none)' }; });
  await safe('app', 'app.forms', 'form actions', () => [...document.forms].map(f => (f.method || 'get').toUpperCase() + ' ' + (f.action ? hostOf(f.action) + new URL(f.action, location.href).pathname : '(js)')).join(' | ') || '(none)');

  const summary = countBy(rows.map(r => r.status));
  const result = { probeVersion: '1.0.0', ranAt: new Date().toISOString(), url: location.href, summary, rows };
  try { window.__BROWSER_PROBE_RESULT__ = result; } catch (e) { /* ignore */ }
  try {
    console.groupCollapsed('%c[Browser Capability Probe] ' + location.host + ' -> ' + JSON.stringify(summary), 'font-weight:bold');
    console.table(rows.map(r => ({ category: r.category, check: r.label, status: r.status, detail: r.detail })));
    console.log('JSON:', JSON.stringify(result));
    console.groupEnd();
  } catch (e) { /* console may be unavailable */ }
  return result;
})()
