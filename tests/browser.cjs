const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const outputs = process.env.QA_OUTPUT_DIR || '/tmp/alexander-calendar-qa';
fs.mkdirSync(outputs, { recursive: true });
const NOW = '2026-10-10T10:00:00.000Z';
const event = (title, start = '2026-10-12', end = '2026-10-13', extras = {}) => ({ title, start, end, allDay: true, ...extras });
let status = 401, payload = { code: 'reauthorization_required' }, apiRequests = 0;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/calendar') { apiRequests++; res.writeHead(status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(payload)); }
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(root + '/') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date(NOW) });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'stale');
  assert(await page.locator('#calendarReconnect').isVisible());
  await page.locator('[data-tab="four"]').click();
  assert(await page.locator('#fourEvents').getByText('Spanska – Kapitelkoll 1–2', { exact: true }).count());
  assert(await page.locator('#fourEvents').getByText('Simhallen', { exact: true }).count());
  assert.equal(await page.locator('#fourEvents').getByText('Genetikprov – preliminärt', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(outputs, 'fallback-four-weeks.png'), fullPage: true });
  for (const tab of ['term', 'school', 'week', 'four', 'term', 'four']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    assert.equal(await page.locator('section.active').getAttribute('id'), tab);
  }
  await page.locator('[data-tab="todo"]').click();
  await page.locator('#listInput').fill('QA list'); await page.locator('#listAdd').click();
  await page.getByText('QA list', { exact: true }).click();
  await page.locator('#taskInput').fill('QA task'); await page.locator('#taskAdd').click();
  assert(await page.getByText('QA task', { exact: true }).isVisible());
  await page.locator('#listBack').click();
  await page.locator('[data-tab="four"]').click();
  status = 200; payload = { events: [event('Shared'), event('<img src=x onerror=alert(1)>')], schoolEvents: [event('Shared')], syncedAt: NOW };
  await page.locator('#calendarRetry').click();
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'live');
  assert.equal(await page.locator('#fourEvents strong').count(), 2);
  assert.equal(await page.locator('#fourEvents img').count(), 0);
  assert.equal(await page.locator('#schoolEvents strong').count(), 1);
  assert.equal(await page.locator('#termEvents strong').count(), 2);
  assert.equal(await page.locator('#calendarReconnect').isVisible(), false);
  const saved = await page.evaluate(() => localStorage.getItem('alexanderCalendarSnapshotV1'));
  status = 503; payload = { code: 'oauth_configuration_error' };
  await page.locator('#calendarRetry').click();
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'stale');
  assert((await page.locator('#calendarStatusText').textContent()).includes('serveranslutning'));
  assert.equal(await page.evaluate(() => localStorage.getItem('alexanderCalendarSnapshotV1')), saved);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'stale');
  assert.equal(await page.locator('#fourEvents strong').count(), 2);
  // Missing timestamps and partial data cannot be labelled live or overwrite last-good data.
  status = 200; payload = { events: [], schoolEvents: [] };
  await page.locator('#calendarRetry').click();
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'stale');
  assert.equal(await page.locator('#termEvents strong').count(), 2);
  payload = { events: [], schoolEvents: [], syncedAt: NOW };
  await page.locator('#calendarRetry').click();
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'live');
  assert.equal(await page.locator('#termEvents strong').count(), 0);
  assert.equal(await page.locator('#fourEvents strong').count(), 0);
  // Real service-worker offline shell: last-good data is retained but is never labelled live.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller && document.querySelector('#calendarStatus').dataset.state === 'live');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#calendarStatus').dataset.state === 'stale');
  assert.equal(await page.locator('#termEvents strong').count(), 0);
  assert((await page.locator('#calendarStatusText').textContent()).includes('senast hämtade'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(outputs, 'offline-last-good.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: mobile fallback, all tabs, todo regression, live dedupe, HTML-safe rendering, retry, configuration failure, last-good reload, missing timestamp, valid empty calendar, real service-worker offline reload, no horizontal overflow or JS errors.');
  console.log(`API requests: ${apiRequests}; screenshots: ${outputs}`);
  await browser.close(); server.close();
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
