// What reading the browser's address through UI Automation costs the browser on Windows: x-win, which reads Chrome's
// address from the web page, against read-address.ps1, which looks only at the address bar. Each phase opens a fresh
// browser with three tabs (a page that changes ten times a second in front, a long static page, Wikipedia), waits for
// it to settle, then for MEASURE_MS reads the address on a timer, as the Trakkar tracker does, or not at all.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { activeWindow } from '@miniben90/x-win';

const WARMUP_MS = 45_000;
const MEASURE_MS = 180_000;
const MEMORY_SAMPLE_MS = 30_000;
const LOOP_MS = 250;
const DEVTOOLS = 'http://127.0.0.1:9222';
const MB = 1024 * 1024;

const BROWSERS = {
  chrome: { exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', image: 'chrome' },
  edge: { exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', image: 'msedge' },
};

const EVERY_MINUTE = 60_000;
const PHASES = [
  { name: 'Chrome, no reading', browser: 'chrome', reader: null },
  { name: 'Chrome, connect only', browser: 'chrome', reader: 'connect' },
  { name: 'Chrome, first Edit', browser: 'chrome', reader: 'first-edit' },
  { name: 'Chrome, toolbar then Edit', browser: 'chrome', reader: 'toolbar-edit' },
  { name: 'Chrome, x-win', browser: 'chrome', reader: 'x-win' },
  { name: 'Edge, no reading', browser: 'edge', reader: null },
  { name: 'Edge, first Edit', browser: 'edge', reader: 'first-edit' },
  { name: 'Edge, toolbar then Edit', browser: 'edge', reader: 'toolbar-edit' },
];

const LIVE_PAGE = `<!doctype html><title>Live board</title>
<style>td{border:1px solid #ccc;padding:2px 4px;font:12px sans-serif}</style>
<table><tbody id="grid"></tbody></table><ul id="feed"></ul>
<script>
const grid = document.getElementById('grid');
for (let r = 0; r < 60; r++) {
  const row = grid.insertRow();
  for (let c = 0; c < 40; c++) row.insertCell().textContent = r + ':' + c;
}
const cells = [...grid.querySelectorAll('td')];
const feed = document.getElementById('feed');
let ticks = 0, drift = 0, maxDrift = 0, longTasks = 0, longTaskMs = 0, last = performance.now();
setInterval(() => {
  const now = performance.now();
  const late = Math.max(0, now - last - 100);
  last = now;
  ticks++;
  drift += late;
  maxDrift = Math.max(maxDrift, late);
  for (let i = 0; i < 200; i++) cells[(Math.random() * cells.length) | 0].textContent = (Math.random() * 1000).toFixed(2);
  const item = document.createElement('li');
  item.textContent = 'Message ' + ticks + ' ' + 'lorem ipsum dolor sit amet '.repeat(4);
  feed.prepend(item);
  if (feed.children.length > 300) feed.lastChild.remove();
}, 100);
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) { longTasks++; longTaskMs += entry.duration; }
}).observe({ entryTypes: ['longtask'] });
window.__reset = () => { ticks = 0; drift = 0; maxDrift = 0; longTasks = 0; longTaskMs = 0; last = performance.now(); };
window.__stats = () => ({ ticks, avgLateMs: ticks ? drift / ticks : 0, maxLateMs: maxDrift, longTasks, longTaskMs });
</script>`;

const ARTICLE_PAGE =
  '<!doctype html><title>Long article</title>' +
  Array.from({ length: 1500 }, (_, i) =>
    `<h3>Section ${i}</h3><p>Paragraph ${i} with <a href="#s${i}">a link</a>, <b>bold</b> text and more words ` +
    'to fill the line. '.repeat(6) + '</p>',
  ).join('');

const PAGES = { '/live': LIVE_PAGE, '/article': ARTICLE_PAGE };

async function main() {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const versions = Object.fromEntries(Object.entries(BROWSERS).map(([key, browser]) => [key, fileVersion(browser.exe)]));
  console.log('Browser versions', versions);

  const results = [];
  for (const phase of PHASES) {
    console.log(`\n=== ${phase.name}`);
    try {
      results.push(await runPhase(phase, origin));
    } catch (error) {
      console.log('Phase failed', error);
      results.push({ name: phase.name, error: String(error?.stack ?? error) });
    }
    console.log(JSON.stringify(results.at(-1), null, 2));
  }
  killBrowsers();
  server.close();

  writeFileSync('results.json', JSON.stringify({ versions, measureMs: MEASURE_MS, results }, null, 2));
  const summary = summaryOf(versions, results);
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

async function runPhase(phase, origin) {
  const browser = BROWSERS[phase.browser];
  killBrowsers();
  launch(browser, phase.flags ?? [], origin);
  const live = await liveTarget();
  await fetch(`${DEVTOOLS}/json/activate/${live.id}`);
  await sleep(WARMUP_MS);

  const front = frontWindow();
  console.log('Front window before measuring', front);
  await evaluate(live, 'window.__reset()');
  const before = processStats(browser.image);
  const reads = [];
  const memoryMb = [];
  const started = Date.now();
  let nextRead = phase.reader ? started : Infinity;
  let nextMemory = started + MEMORY_SAMPLE_MS;
  while (Date.now() - started < MEASURE_MS) {
    if (Date.now() >= nextRead) {
      reads.push(phase.reader === 'x-win' ? readWithXWin() : readAddressBar(phase.reader));
      nextRead += EVERY_MINUTE;
    }
    if (Date.now() >= nextMemory) {
      memoryMb.push(privateMb(processStats(browser.image)));
      nextMemory += MEMORY_SAMPLE_MS;
    }
    await sleep(LOOP_MS);
  }
  const elapsedS = (Date.now() - started) / 1000;
  const after = processStats(browser.image);
  const page = await evaluate(live, 'window.__stats()');
  const accessibility = await accessibilityMode();

  return {
    name: phase.name,
    front,
    reads,
    browserCpuPercentOfOneCore: (cpuSecondsBetween(before, after) / elapsedS) * 100,
    privateMbStart: privateMb(before),
    privateMbEnd: privateMb(after),
    privateMbMax: Math.max(privateMb(before), ...memoryMb, privateMb(after)),
    processes: after.length,
    page,
    accessibility,
  };
}

function launch(browser, flags, origin) {
  const profile = mkdtempSync(join(tmpdir(), 'browser-cost-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    ...flags,
    `${origin}/article`,
    'https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population',
    `${origin}/live`,
  ];
  spawn(browser.exe, args, { detached: true, stdio: 'ignore' }).unref();
}

async function liveTarget() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`${DEVTOOLS}/json/list`)).json();
      const live = targets.find((target) => target.type === 'page' && target.url.endsWith('/live'));
      if (live) return live;
    } catch {
      // The browser is still starting.
    }
    await sleep(1000);
  }
  throw new Error('The browser never opened the live page');
}

/** The x-win call the tracker makes: the window in front, then its address. */
function readWithXWin() {
  const started = performance.now();
  try {
    const front = activeWindow();
    const address = front.url;
    return { ms: performance.now() - started, app: front.info.execName, title: front.title, address };
  } catch (error) {
    return { ms: performance.now() - started, error: String(error) };
  }
}

/** read-address.ps1 in a new PowerShell; `ms` is its UI Automation time, without PowerShell's start-up. */
function readAddressBar(variant) {
  const started = performance.now();
  try {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'read-address.ps1', '-Variant', variant];
    const reply = JSON.parse(execFileSync('powershell.exe', args, { encoding: 'utf8' }).trim());
    return { ...reply, ms: reply.uiaMs, spawnMs: performance.now() - started };
  } catch (error) {
    return { ms: performance.now() - started, error: String(error) };
  }
}

function frontWindow() {
  try {
    const front = activeWindow();
    return { app: front.info.execName, title: front.title };
  } catch (error) {
    return { error: String(error) };
  }
}

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const reply = new Promise((resolve) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    };
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  const message = await reply;
  socket.close();
  return message.result?.result?.value ?? message.result?.exceptionDetails ?? message.error;
}

/** What chrome://accessibility says about the global accessibility mode, read after the phase. */
async function accessibilityMode() {
  const target = await (await fetch(`${DEVTOOLS}/json/new?chrome://accessibility`, { method: 'PUT' })).json();
  await sleep(3000);
  const page = await evaluate(
    target,
    `JSON.stringify({
      switches: [...document.querySelectorAll('input[type=checkbox], [role=switch], [aria-pressed], [aria-checked]')]
        .map((element) => ({
          id: element.id || element.name || '',
          label: (element.closest('label')?.innerText || element.parentElement?.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 80),
          on: element.checked ?? element.getAttribute('aria-pressed') ?? element.getAttribute('aria-checked'),
          disabled: !!element.disabled,
        })),
      text: document.body.innerText.slice(0, 1500),
    })`,
  );
  await fetch(`${DEVTOOLS}/json/close/${target.id}`);
  return typeof page === 'string' ? JSON.parse(page) : page;
}

function processStats(image) {
  const script =
    `Get-Process -Name ${image} -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ ` +
    'id = $_.Id; cpu = $_.TotalProcessorTime.TotalSeconds; privateBytes = $_.PrivateMemorySize64 } } | ConvertTo-Json -Compress';
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// A process that started during the phase counts in full; one that ended loses its time.
function cpuSecondsBetween(before, after) {
  const startCpu = new Map(before.map((process) => [process.id, process.cpu]));
  return after.reduce((sum, process) => sum + process.cpu - (startCpu.get(process.id) ?? 0), 0);
}

function privateMb(processes) {
  return processes.reduce((sum, process) => sum + process.privateBytes, 0) / MB;
}

function killBrowsers() {
  for (const browser of Object.values(BROWSERS)) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/IM', `${browser.image}.exe`], { stdio: 'ignore' });
    } catch {
      // Nothing was running.
    }
  }
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 3']);
}

function fileVersion(exe) {
  try {
    const script = `(Get-Item '${exe}').VersionInfo.ProductVersion`;
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  } catch {
    return 'not found';
  }
}

function startServer() {
  const server = createServer((request, response) => {
    const page = PAGES[request.url];
    if (!page) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function summaryOf(versions, results) {
  const lines = [
    '## Browser cost of address reads',
    '',
    `Chrome ${versions.chrome}, Edge ${versions.edge}. Each phase: ${MEASURE_MS / 1000}s after a ${WARMUP_MS / 1000}s warm-up.`,
    '',
    '| Phase | Reads with address | Read ms (avg / max) | Browser CPU % of one core | Private MB end (max) | Late timer ms (avg / max) | Long tasks (ms) | Accessibility on (native / web / extended) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    if (result.error) {
      lines.push(`| ${result.name} | failed: ${result.error.split('\n')[0]} | | | | | | |`);
      continue;
    }
    const withAddress = result.reads.filter((read) => read.address).length;
    const times = result.reads.map((read) => read.ms);
    const readMs = times.length ? `${average(times).toFixed(0)} / ${Math.max(...times).toFixed(0)}` : '–';
    const page = result.page ?? {};
    lines.push(
      `| ${result.name} | ${result.reads.length ? `${withAddress}/${result.reads.length}` : '–'} | ${readMs} | ` +
        `${result.browserCpuPercentOfOneCore.toFixed(1)} | ${result.privateMbEnd.toFixed(0)} (${result.privateMbMax.toFixed(0)}) | ` +
        `${(page.avgLateMs ?? 0).toFixed(1)} / ${(page.maxLateMs ?? 0).toFixed(0)} | ${page.longTasks ?? '–'} (${(page.longTaskMs ?? 0).toFixed(0)}) | ` +
        `${webAccessibility(result.accessibility)} |`,
    );
  }
  lines.push('', 'Addresses read:', '');
  for (const result of results) {
    const read = result.reads?.find((each) => each.address) ?? result.reads?.[0];
    if (read) lines.push(`- ${result.name}: ${JSON.stringify({ address: read.address, box: read.boxName, focused: read.focused, error: read.error })}`);
  }
  return lines.join('\n') + '\n';
}

function webAccessibility(mode) {
  const on = (id) => String(mode?.switches?.find((item) => item.id === id)?.on ?? '?');
  return `${on('native')} / ${on('web')} / ${on('extendedProperties')}`;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

await main();
