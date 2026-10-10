const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../calendar-view.js');
const now = new Date('2026-10-10T10:00:00Z');
const e = (title, start = '2026-10-12', end = '2026-10-13', extra = {}) => ({ title, start, end, allDay: true, sources: ['personal'], ...extra });

test('all views use the same published fallback and exclude past events', () => {
  const events = model.normalizeEvents(model.fallback);
  assert.equal(events.length, 18);
  const four = model.forView(events, 'four', now).map(e => e.title);
  assert(four.includes('Spanska – Kapitelkoll 1–2'));
  assert(four.includes('Simhallen'));
  assert(four.includes('Lyktfest – klass 2 leder'));
  assert(!four.includes('Genetikprov – preliminärt'));
  assert(!four.includes('PRAO (v.47)'));
  assert.equal(model.forView(events, 'term', now).length, 17);
  assert.equal(model.forView(events, 'week', now).length, 0);
});
test('deduplicates copied events across calendars while keeping distinct times', () => {
  const data = model.fromResponse({ events: [e('Shared'), e('Shared', '2026-10-13', '2026-10-14')], schoolEvents: [e(' shared ')] });
  assert.equal(data.length, 2);
  assert.deepEqual(data[0].sources, ['personal', 'school']);
  assert.equal(model.forView(data, 'school', now).length, 1);
});
test('deduplicates matching iCalUID occurrences but retains recurring dates', () => {
  const data = model.normalizeEvents([e('One', undefined, undefined, { iCalUID: 'uid' }), e('Renamed copy', undefined, undefined, { iCalUID: 'uid', sources: ['school'] }), e('One', '2026-10-13', '2026-10-14', { iCalUID: 'uid' })]);
  assert.equal(data.length, 2);
  assert.deepEqual(data[0].sources, ['personal', 'school']);
});
test('keeps ongoing multi-day events with exclusive all-day end', () => {
  const events = model.normalizeEvents([e('Trip', '2026-10-08', '2026-10-12')]);
  assert.equal(model.forView(events, 'week', now).length, 1);
  assert.equal(model.forView(events, 'term', new Date('2026-10-11T22:01:00Z')).length, 0);
});
test('Stockholm day boundaries and DST do not depend on the device timezone', () => {
  assert.equal(model.dayKey('2026-10-10T22:30:00Z'), '2026-10-11');
  assert.equal(model.addDays('2026-10-24', 2), '2026-10-26');
  const events = model.normalizeEvents([e('Sunday', '2026-10-11', '2026-10-12'), e('Monday', '2026-10-12', '2026-10-13')]);
  assert.deepEqual(model.forView(events, 'week', now).map(e => e.title), ['Sunday']);
});
test('4 weeks is 28 days, and ended timed events are excluded', () => {
  const events = model.normalizeEvents([e('Last day', '2026-11-06', '2026-11-07'), e('Outside', '2026-11-07', '2026-11-08'), e('Ended', '2026-10-10T09:00:00Z', '2026-10-10T09:30:00Z', { allDay: false }), e('Ongoing', '2026-10-10T09:00:00Z', '2026-10-10T11:00:00Z', { allDay: false })]);
  assert.deepEqual(model.forView(events, 'four', now).map(e => e.title), ['Ongoing', 'Last day']);
});
test('empty complete live snapshots are valid; malformed/partial responses are not', () => {
  assert.deepEqual(model.fromResponse({ events: [], schoolEvents: [] }), []);
  assert.throws(() => model.fromResponse({ events: [] }));
  assert.throws(() => model.fromResponse({ events: [e('Bad', 'bad')], schoolEvents: [] }));
});
test('corrupt/unavailable storage cannot override the fallback', () => {
  assert.equal(model.readSnapshot({ getItem() { throw new Error('Denied'); } }), null);
  assert.equal(model.readSnapshot({ getItem() { return '{'; } }), null);
  assert.equal(model.readSnapshot({ getItem() { return JSON.stringify({ version: 1, syncedAt: now.toISOString(), events: [e('Bad', 'bad')] }); } }), null);
  assert.deepEqual(model.readSnapshot({ getItem() { return JSON.stringify({ version: 1, syncedAt: now.toISOString(), events: [] }); } }).events, []);
});

const handlerSource = fs.readFileSync(path.join(__dirname, '../api/calendar.js'), 'utf8').replace('export default async function handler', 'async function handler') + '\nmodule.exports = handler;';
async function runApi(route, env = { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret', SUPABASE_URL: 'https://db.test', SUPABASE_SECRET_KEY: 'test-store-secret' }) {
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url: String(url), options }); return route(String(url), options); };
  const context = { module: { exports: {} }, process: { env }, fetch, URLSearchParams, AbortSignal, Date };
  vm.runInNewContext(handlerSource, context);
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(data) { this.data = JSON.parse(JSON.stringify(data)); return this; } };
  await context.module.exports({}, response);
  return { ...response, calls };
}
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const tokenRoute = token => url => url.startsWith('https://db.test') ? reply([{ refresh_token: 'never-expose' }]) : reply(token, 400);
test('API identifies invalid_grant without returning credentials or provider details', async () => {
  const r = await runApi(tokenRoute({ error: 'invalid_grant', error_description: 'secret provider details' }));
  assert.equal(r.statusCode, 401); assert.equal(r.data.code, 'reauthorization_required'); assert.equal(r.data.connect, '/api/oauth/start');
  assert(!JSON.stringify(r.data).includes('secret')); assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('API distinguishes client configuration and transient token errors', async () => {
  for (const code of ['invalid_client', 'unauthorized_client']) {
    const r = await runApi(tokenRoute({ error: code })); assert.equal(r.statusCode, 503); assert.equal(r.data.code, 'oauth_configuration_error'); assert(!r.data.connect);
  }
  const r = await runApi(tokenRoute({ error: 'temporarily_unavailable' })); assert.equal(r.statusCode, 502); assert.equal(r.data.code, 'token_refresh_failed');
});
test('API distinguishes missing tokens from an unavailable token store', async () => {
  const missing = await runApi(() => reply([])); assert.equal(missing.data.code, 'calendar_not_connected');
  const outage = await runApi(() => reply({}, 503)); assert.equal(outage.data.code, 'token_store_unavailable'); assert(!outage.data.connect);
  const config = await runApi(() => { throw new Error('Should not fetch'); }, {}); assert.equal(config.data.code, 'configuration_missing');
});
test('API paginates calendars and both event sets without publishing partial success', async () => {
  const googleEvent = { id: 'one', iCalUID: 'shared', summary: 'Test', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } };
  const route = url => {
    if (url.startsWith('https://db.test')) return reply([{ refresh_token: 'test' }]);
    if (url.includes('oauth2')) return reply({ access_token: 'test-access' });
    const q = new URL(url).searchParams;
    if (url.includes('calendarList')) return reply(q.has('pageToken') ? { items: [{ id: 'school', summary: 'Waldorf School' }] } : { items: [{ id: 'alex', summary: 'Alexander Personal' }], nextPageToken: 'next-calendars' });
    if (url.includes('/school/')) return reply({ items: [googleEvent] });
    return reply(q.has('pageToken') ? { items: [{ ...googleEvent, id: 'two' }, { status: 'cancelled' }] } : { items: [googleEvent], nextPageToken: 'next-events' });
  };
  const r = await runApi(route);
  assert.equal(r.statusCode, 200); assert.equal(r.data.events.length, 2); assert.equal(r.data.schoolEvents.length, 1); assert(r.data.syncedAt);
  assert(r.calls.some(c => c.url.includes('pageToken=next-events')));
  const failed = await runApi(url => url.includes('/school/') ? reply({}, 500) : route(url));
  assert.equal(failed.statusCode, 502); assert(!failed.data.events);
});
test('API converts thrown network and malformed JSON responses into safe errors', async () => {
  const r = await runApi(() => { throw new Error('Contains private details'); }); assert.equal(r.data.code, 'calendar_unavailable'); assert(!JSON.stringify(r.data).includes('private'));
});
test('service worker leaves API requests alone and caches only the shell', () => {
  const listeners = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), {
    self: { addEventListener(name, fn) { listeners[name] = fn; } }, location: { origin: 'https://app.test' }, URL
  });
  for (const path of ['/api/calendar', '/api/oauth/callback?code=test', '/not-shell']) {
    let handled = false;
    listeners.fetch({ request: { method: 'GET', url: 'https://app.test' + path }, respondWith() { handled = true; } });
    assert.equal(handled, false);
  }
});
test('sorts timed events by actual instant across mixed offsets', () => {
  const events = model.normalizeEvents([e('Later', '2026-10-12T08:30:00Z', '2026-10-12T09:00:00Z', { allDay: false }), e('Earlier', '2026-10-12T10:00:00+02:00', '2026-10-12T10:20:00+02:00', { allDay: false })]);
  assert.deepEqual(events.map(e => e.title), ['Earlier', 'Later']);
});
test('missing required school calendar cannot replace the last-good snapshot', async () => {
  const r = await runApi(url => url.startsWith('https://db.test') ? reply([{ refresh_token: 'test' }]) : url.includes('oauth2') ? reply({ access_token: 'test' }) : reply({ items: [{ id: 'alex', summary: 'Alexander Personal' }] }));
  assert.equal(r.statusCode, 502); assert.equal(r.data.code, 'school_calendar_not_found'); assert(!r.data.events);
});
test('DST repeated local hour is ordered by instant', () => {
  const events = model.normalizeEvents([e('Later', '2026-10-25T02:15:00+01:00', '2026-10-25T02:30:00+01:00', { allDay: false }), e('Earlier', '2026-10-25T02:45:00+02:00', '2026-10-25T02:55:00+02:00', { allDay: false })]);
  assert.deepEqual(events.map(e => e.title), ['Earlier', 'Later']);
});

async function mountCalendar(initialResponse, store = new Map()) {
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ''; }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const ids = Object.fromEntries(['calendarStatus', 'calendarStatusText', 'calendarRetry', 'calendarReconnect', 'todayDate', 'weekEvents', 'fourEvents', 'termEvents', 'schoolEvents'].map(id => [id, new Element()]));
  const listeners = {}; let response = initialResponse, calls = 0;
  const storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-10T10:00:00Z'])); } static now() { return Date.parse('2026-10-10T10:00:00Z'); } }
  const context = {
    document: { getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener: (type, fn) => { listeners[type] = fn; } },
    window: { localStorage: storage }, navigator: { serviceWorker: { addEventListener: (type, fn) => { listeners[type] = fn; } } },
    fetch: async () => { calls++; if (response instanceof Error) throw response; return { ok: response.status === 200, status: response.status, json: async () => response.data }; },
    crypto: { randomUUID: () => 'test-nonce-' + calls }, AbortSignal, Date: FixedDate, Intl, URLSearchParams, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../calendar-view.js'), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { ids, store, listeners, calls: () => calls, retry: async next => { response = next; await ids.calendarRetry.onclick(); await settle(); } };
}
test('client DOM uses shared saved fallback and visible reconnect warning', async () => {
  const app = await mountCalendar({ status: 401, data: { code: 'reauthorization_required' } });
  assert.equal(app.ids.calendarStatus.dataset.state, 'stale');
  assert.equal(app.ids.calendarReconnect.hidden, false);
  const titles = app.ids.fourEvents.children.map(c => c.children.find(n => n.tagName === 'strong')?.textContent);
  assert(titles.includes('Spanska – Kapitelkoll 1–2')); assert(titles.includes('Simhallen'));
  assert(app.ids.fourEvents.children.every(c => c.children.at(-1).textContent === 'Sparad planering'));
});
test('client DOM retains last-good data across failures/reload and accepts an empty live calendar', async () => {
  const live = { status: 200, data: { events: [e('<img src=x onerror=alert(1)>')], schoolEvents: [e('<img src=x onerror=alert(1)>')], syncedAt: now.toISOString() } };
  const app = await mountCalendar(live);
  assert.equal(app.ids.calendarStatus.dataset.state, 'live'); assert.equal(app.ids.fourEvents.children.length, 1);
  assert.equal(app.ids.schoolEvents.children.length, 1);
  assert.equal(app.ids.termEvents.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  const saved = app.store.get(model.CACHE_KEY);
  await app.retry({ status: 503, data: { code: 'oauth_configuration_error' } });
  assert.equal(app.ids.calendarStatus.dataset.state, 'stale'); assert.equal(app.ids.calendarReconnect.hidden, true);
  assert.equal(app.store.get(model.CACHE_KEY), saved);
  const reloaded = await mountCalendar(new Error('Offline'), app.store);
  assert.equal(reloaded.ids.termEvents.children.length, 1);
  assert(reloaded.ids.calendarStatusText.textContent.includes('senast hämtade'));
  await app.retry({ status: 200, data: { events: [], schoolEvents: [] } });
  assert.equal(app.ids.calendarStatus.dataset.state, 'stale'); assert.equal(app.store.get(model.CACHE_KEY), saved);
  await app.retry({ status: 200, data: { events: [], schoolEvents: [], syncedAt: now.toISOString() } });
  assert.equal(app.ids.calendarStatus.dataset.state, 'live');
  assert.equal(app.ids.termEvents.children[0].textContent, 'Inga kommande händelser i den här vyn.');
});
test('client timed multi-day label includes both dates', async () => {
  const app = await mountCalendar({ status: 200, data: { events: [e('Overnight', '2026-10-11T23:00:00+02:00', '2026-10-12T07:00:00+02:00', { allDay: false })], schoolEvents: [], syncedAt: now.toISOString() } });
  const label = app.ids.fourEvents.children[0].children[0].textContent;
  assert(label.includes('11')); assert(label.includes('12'));
});
