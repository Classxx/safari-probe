// Настоящий Safari: macOS-версия и iOS/iPadOS в симуляторе — через safaridriver.
// Секреты (адрес стенда, кука доступа) только из окружения; в лог не пишем.
import { Builder } from 'selenium-webdriver';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const { BASE, GATE, PATHS = '/', TARGETS = 'mac:1440x900', LOGIN = 'true' } = process.env;
const DETECT = fs.readFileSync(new URL('./detect.js', import.meta.url), 'utf8');
fs.mkdirSync('out', { recursive: true });
const results = [];
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Логи публичного репозитория видны всем: адрес стенда и ключ из текста ошибок вычищаем
// (GitHub маскирует секреты сам, это второй слой). Подробности — только в зашифрованном out/.
const clean = (s) => { let x = String(s); for (const v of [GATE, BASE, BASE && new URL(BASE).host]) if (v) x = x.split(v).join('***'); return x; };

async function open(target) {
  const [kind, spec] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
  let caps = { browserName: 'safari' };
  if (kind !== 'mac') {
    // Симулятор грузим здесь, по одному: safaridriver берёт любой загруженный, и при
    // двух сразу «iPhone SE» снимался как 16 Pro. Остальные гасим.
    const list = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' })).devices;
    const all = Object.entries(list).sort((a, b) => (a[0] < b[0] ? 1 : -1)).flatMap(([, v]) => v);
    const dev = all.find((x) => x.name === spec);
    if (!dev) throw new Error('нет симулятора ' + spec);
    for (const x of all) if (x.state === 'Booted' && x.udid !== dev.udid) { try { execFileSync('xcrun', ['simctl', 'shutdown', x.udid]); } catch {} }
    try { execFileSync('xcrun', ['simctl', 'boot', dev.udid]); } catch {}
    execFileSync('xcrun', ['simctl', 'bootstatus', dev.udid, '-b'], { timeout: 300000 });
    for (const k of ['RemoteAutomationEnabled', 'WebDriverEnabled', 'WebKitRemoteAutomationEnabled', 'AllowRemoteAutomation']) {
      try { execFileSync('xcrun', ['simctl', 'spawn', dev.udid, 'defaults', 'write', 'com.apple.mobilesafari', k, '-bool', 'YES']); } catch {}
    }
    // Первый запуск Safari в свежем симуляторе долгий — без прогрева safaridriver не дожидается его.
    try { execFileSync('xcrun', ['simctl', 'launch', dev.udid, 'com.apple.mobilesafari'], { timeout: 90000 }); } catch {}
    await sleep(10000);
    try { execFileSync('xcrun', ['simctl', 'terminate', dev.udid, 'com.apple.mobilesafari'], { timeout: 30000 }); } catch {}
    caps = { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceUDID': dev.udid, 'safari:deviceType': kind === 'ipad' ? 'iPad' : 'iPhone' };
  }
  console.log('сессия', target);
  // Первая сессия safaridriver на свежем раннере иногда падает «internal error» — повтор.
  let d;
  for (let t = 0; ; t++) { try { d = await new Builder().withCapabilities(caps).build(); break; } catch (e) { if (t >= 2) throw e; console.log('повтор сессии', target); await sleep(5000); } }
  console.log('сессия открыта', target);
  if (kind === 'mac') { const [w, h] = spec.split('x').map(Number); try { await d.manage().window().setRect({ width: w, height: h + 80, x: 0, y: 0 }); } catch (e) { console.log('setRect:', clean(String(e.message).split('\n')[0])); } }
  return d;
}

async function gateAndLogin(d) {
  await d.get(BASE + '/robots.txt');
  // Safari на macOS падает «internal error» на addCookie — тогда ставим куку из страницы
  // (nginx нужна только сама кука, HttpOnly не обязателен).
  try { await d.manage().addCookie({ name: 'devgate', value: GATE, path: '/', secure: true, domain: new URL(BASE).hostname }); }
  catch { await d.executeScript('document.cookie = arguments[0]', 'devgate=' + GATE + '; path=/; secure; samesite=lax'); }
  await d.executeScript("try{localStorage.setItem('cookie_notice_seen','1')}catch(e){}");
  if (LOGIN !== 'true') return 'guest';
  return d.executeAsyncScript(function (done) {
    var email = 'claude-ui@anlok.test';
    fetch('/api/auth/email-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
      .then(function (r) { return r.json(); })
      .then(function (s) { return fetch('/api/auth/email-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, code: s.dev_code }) }); })
      .then(function (v) { return v.json().then(function (b) { return fetch('/api/auth/me').then(function (m) { return m.json(); }).then(function (me) { localStorage.setItem('anlok_session_user', JSON.stringify({ user: b.user || me })); done('ok ' + v.status); }); }); })
      .catch(function (e) { done('login error ' + e); });
  });
}

for (const target of TARGETS.split(',').map((s) => s.trim()).filter(Boolean)) {
  let d;
  try {
    d = await open(target);
    const login = await gateAndLogin(d);
    const caps = await d.getCapabilities();
    for (const p of PATHS.split(',')) {
      const r = { target, page: p, login, browser: caps.get('browserVersion'), platform: caps.get('platformName') };
      try {
        await d.get(BASE + p);
        await sleep(6000);
        await d.executeAsyncScript(function (done) {
          var sc = document.getElementById('app-scroll'); var el = sc && sc.scrollHeight > sc.clientHeight + 2 ? sc : document.scrollingElement; var k = 0;
          (function step() { if (k++ < 40 && el.scrollTop + el.clientHeight < el.scrollHeight - 2) { el.scrollTop += 700; setTimeout(step, 250); } else { el.scrollTop = 0; setTimeout(done, 1500); } })();
        });
        r.env = await d.executeScript('return {vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, scrollW: document.documentElement.scrollWidth}');
        r.issues = await d.executeScript('return (' + DETECT + ')()');
        // Экранами подряд (до 6): телефон листает #app-scroll, компьютер — документ.
        r.shots = [];
        for (let k = 0; k < 6; k++) {
          const more = await d.executeScript('var sc=document.getElementById("app-scroll");var el=sc&&sc.scrollHeight>sc.clientHeight+2?sc:document.scrollingElement;var y=arguments[0]*(el.clientHeight-80);if(arguments[0]>0&&y>=el.scrollHeight-el.clientHeight+80)return false;el.scrollTop=y;return true;', k);
          if (!more) break;
          await sleep(500);
          const f = slug(p) + '__' + slug(target) + '_' + k + '.png';
          fs.writeFileSync('out/' + f, await d.takeScreenshot(), 'base64');
          r.shots.push(f);
        }
      } catch (e) { r.error = clean(String(e.message || e).split('\n')[0]).slice(0, 300); }
      results.push(r);
      console.log(target, p, r.error ? 'ОШИБКА' : 'ок', (r.issues || []).length);
    }
  } catch (e) { results.push({ target, error: 'запуск: ' + clean(String(e.message || e).split('\n')[0]).slice(0, 300) }); console.log(target, 'не запустился:', clean(String(e.message || e).split('\n')[0]).slice(0, 300)); fs.writeFileSync('out/error-' + slug(target) + '.txt', clean(String(e.stack || e))); }
  if (d) await d.quit().catch(() => {});
}
fs.writeFileSync('out/report.json', JSON.stringify(results, null, 1));
