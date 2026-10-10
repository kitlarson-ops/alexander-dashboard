/* One calendar snapshot drives Week, 4 Weeks, Term and School. */
(function () {
  const TIME_ZONE = 'Europe/Stockholm';
  const TERM_END = '2027-01-01';
  const CACHE_KEY = 'alexanderCalendarSnapshotV1';
  // Existing published term fallback, retained as saved planning, never claimed to be live.
  const fallbackRows = [
    ['2026-10-09', '2026-10-10', '9 okt', 'Genetikprov – preliminärt', '08:10–09:00', 'Mindre prov i genetik och evolution. Exakt provdatum är ännu inte bekräftat av skolan.', 'test'],
    ['2026-10-12', '2026-10-13', '12 okt', 'Spanska – Kapitelkoll 1–2', '12:00–12:55', 'Spanska. Kapitelkoll 1–2. Prov/förhör enligt skolinformationen.', 'test'],
    ['2026-10-13', '2026-10-14', '13 okt', 'Simhallen', '11:00–15:00 · Uddevalla', 'Idrott och hälsa. Klass 5–9 åker till simhallen i Uddevalla.', 'school'],
    ['2026-10-15', '2026-10-16', '15 okt', 'Matteprov', '10:00–11:15', 'Prov på kapitel 2 i Z-boken: samband och förändring.', 'test'],
    ['2026-10-19', '2026-10-20', '19 okt', 'Berlinresan – avgång Göteborg C', '07:55', 'Gruppen ska vara på Göteborg Central senast 07:30.', 'school'],
    ['2026-10-23', '2026-10-24', '23 okt', 'Lyktfest – klass 2 leder', '', 'Waldorf School.', 'school', true],
    ['2026-10-24', '2026-10-25', '24 okt', 'Berlinresan – ankomst Göteborg', '20:05', 'Hämtning i Göteborg efter Berlinresan.', 'school'],
    ['2026-10-26', '2026-11-02', '26 okt–1 nov', 'Lovvecka (v.44)', '', '', 'school'],
    ['2026-11-02', '2026-12-05', '2 nov–4 dec', 'Muntliga nationella prov – Åk 9', '', 'Svenska A, engelska A och matematik A. Exakta provdagar är inte angivna.', 'test'],
    ['2026-11-03', '2026-11-06', '3–5 nov', 'Gymnasiemässa i Göteborg', '', 'Mer information om gymnasievalet kommer senare.', 'school'],
    ['2026-11-16', '2026-11-21', '16–20 nov', 'PRAO (v.47)', '', 'PRAO 16–20 november.', 'school'],
    ['2026-11-21', '2026-11-22', '21 nov', 'Bazar', '', 'Skolan.', 'school', true],
    ['2026-11-23', '2026-11-24', '23 nov', 'Studiedag', '', '', 'school', true],
    ['2026-11-30', '2026-12-01', '30 nov', 'Adventspiral', '', 'Månstenen.', 'school', true],
    ['2026-12-07', '2026-12-12', '7–11 dec', 'Åk 9 presenterar Nobelpristagare', '', 'Presentationer för skolans klasser.', 'school'],
    ['2026-12-10', '2026-12-11', '10 dec', 'Nobelmiddag – trerätters och dans', '', 'Kvällstid på skolan. Exakt tid ej angiven.', 'school'],
    ['2026-12-16', '2026-12-17', '16 dec', 'Jullunch på skolan', '', '', 'school'],
    ['2026-12-18', '2026-12-19', '18 dec', 'Julavslutning', '10:00–11:00 · Torp kyrka', '', 'school', true]
  ];
  const fallback = fallbackRows.map(([start, end, dateLabel, title, timeLabel, description, kind, school]) => ({
    start, end, dateLabel, title, timeLabel, description, kind, savedPlanning: true, allDay: true, sources: [school ? 'school' : 'personal']
  }));
  const dayKey = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value));
  const addDays = (day, days) => {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const normalizeEvents = events => {
    if (!Array.isArray(events)) throw new Error('Invalid calendar snapshot');
    const result = [], keys = new Map();
    for (const event of events) {
      if (!event || typeof event.title !== 'string' || typeof event.start !== 'string' || typeof event.end !== 'string'
        || !Number.isFinite(Date.parse(event.start)) || !Number.isFinite(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start)) {
        throw new Error('Invalid calendar event');
      }
      const e = { ...event, sources: Array.isArray(event.sources) ? event.sources.filter(s => s === 'personal' || s === 'school') : ['personal'] };
      const start = e.allDay ? e.start : new Date(e.start).toISOString();
      const end = e.allDay ? e.end : new Date(e.end).toISOString();
      const titleKey = 'title:' + e.title.normalize('NFKC').trim().toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ') + '|' + start + '|' + end;
      const uidKey = e.iCalUID ? 'uid:' + e.iCalUID + '|' + start : null;
      const previous = (uidKey && keys.get(uidKey)) || keys.get(titleKey);
      if (previous) {
        previous.sources = [...new Set([...previous.sources, ...e.sources])];
        if (!previous.description) previous.description = e.description;
        if (!previous.location) previous.location = e.location;
      } else {
        result.push(e);
      }
      keys.set(titleKey, previous || e);
      if (uidKey) keys.set(uidKey, previous || e);
    }
    return result.sort((a, b) => dayKey(a.start).localeCompare(dayKey(b.start)) || Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title, 'sv'));
  };
  const fromResponse = data => {
    if (!data || !Array.isArray(data.events) || !Array.isArray(data.schoolEvents)) throw new Error('Incomplete calendar response');
    return normalizeEvents([
      ...data.events.map(e => ({ ...e, sources: ['personal'] })),
      ...data.schoolEvents.map(e => ({ ...e, sources: ['school'] }))
    ]);
  };
  const forView = (events, view, now = new Date()) => {
    const today = dayKey(now.toISOString());
    const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
    const end = view === 'week' ? addDays(today, 7 - ((weekday + 6) % 7)) : view === 'four' ? addDays(today, 28) : TERM_END;
    return events.filter(e => dayKey(e.start) < end && dayKey(e.start) < TERM_END
      && (e.allDay ? e.end > today : new Date(e.end) > now)
      && (view !== 'school' || e.sources.includes('school')));
  };
  const readSnapshot = storage => {
    try {
      const snapshot = JSON.parse(storage.getItem(CACHE_KEY));
      if (snapshot?.version === 1 && Number.isFinite(Date.parse(snapshot.syncedAt))) {
        return { ...snapshot, events: normalizeEvents(snapshot.events) };
      }
    } catch { /* A denied or corrupt device cache must not hide the saved plan. */ }
    return null;
  };
  const api = { normalizeEvents, fromResponse, forView, fallback, dayKey, addDays, readSnapshot, CACHE_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  const status = document.getElementById('calendarStatus');
  const statusText = document.getElementById('calendarStatusText');
  const retry = document.getElementById('calendarRetry');
  const reconnect = document.getElementById('calendarReconnect');
  let storage;
  try { storage = window.localStorage; } catch { /* Storage may be unavailable. */ }
  let snapshot = readSnapshot(storage);
  let events = snapshot?.events || normalizeEvents(fallback);
  let live = false, syncing = false;
  const fmtDate = value => new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TIME_ZONE }).format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value));
  const fmtTime = value => new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE }).format(new Date(value));
  const savedText = () => snapshot ? 'Visar senast hämtade kalendern (' + new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(snapshot.syncedAt)) + ').' : 'Visar sparad planering.';
  const setStatus = (state, message, canReconnect = false) => {
    status.dataset.state = state;
    statusText.textContent = message;
    reconnect.hidden = !canReconnect;
  };
  function makeCard(e) {
    const card = document.createElement('div');
    card.className = 'card event ' + (e.kind || (/prov|läxa|läxor|inlämning|uppgift|repetera|plugga/i.test(e.title + ' ' + (e.description || '')) ? 'test' : 'school'));
    card.dataset.eventDate = dayKey(e.start);
    const add = (tag, className, text) => {
      const el = document.createElement(tag); el.className = className; el.textContent = text; card.appendChild(el);
    };
    let dateLabel = e.dateLabel || fmtDate(e.start);
    if (!e.dateLabel && e.allDay && e.end > addDays(e.start, 1)) dateLabel += ' – ' + fmtDate(addDays(e.end, -1));
    if (!e.dateLabel && !e.allDay && dayKey(e.start) !== dayKey(e.end)) dateLabel += ' – ' + fmtDate(e.end);
    add('div', 'day', dateLabel);
    add('strong', '', e.title);
    const time = e.timeLabel ?? (e.allDay ? 'Heldag' : fmtTime(e.start) + '–' + fmtTime(e.end));
    if (time || e.location) add('div', 'muted small', time + (e.location ? ' · ' + e.location : ''));
    if (e.description) add('div', 'small', String(e.description).replace(/<[^>]*>/g, ''));
    add('span', 'badge', e.savedPlanning ? 'Sparad planering' : e.sources.map(s => s === 'school' ? 'Waldorf School' : 'Alexander Personal').join(' + ') + (live ? ' · Live' : ' · Sparat'));
    return card;
  }
  function refreshViews() {
    const now = new Date();
    document.getElementById('todayDate').textContent = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long', timeZone: TIME_ZONE }).format(now);
    for (const view of ['week', 'four', 'term', 'school']) {
      const host = document.getElementById(view + 'Events');
      host.replaceChildren(...forView(events, view, now).map(makeCard));
      if (!host.children.length) {
        const empty = document.createElement('div'); empty.className = 'card muted';
        empty.textContent = live ? 'Inga kommande händelser i den här vyn.' : 'Inga händelser i det sparade underlaget för den här vyn. Kalendern kan sakna uppdateringar.';
        host.appendChild(empty);
      }
    }
  }
  async function syncLiveCalendar() {
    if (syncing) return;
    syncing = true; retry.disabled = true;
    setStatus('checking', 'Kontrollerar kalendern… ' + savedText());
    try {
      const r = await fetch('/api/calendar?request=' + crypto.randomUUID(), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      if (!r.ok) throw { code: data.code, status: r.status };
      const nextEvents = fromResponse(data);
      if (typeof data.syncedAt !== 'string' || !Number.isFinite(Date.parse(data.syncedAt))) throw new Error('Missing sync timestamp');
      const syncedAt = data.syncedAt;
      snapshot = { version: 1, syncedAt, events: nextEvents };
      events = nextEvents; live = true;
      try { storage?.setItem(CACHE_KEY, JSON.stringify(snapshot)); } catch { /* Keep the in-memory last good result. */ }
      setStatus('live', 'Kalendern är uppdaterad.');
    } catch (error) {
      live = false;
      const canReconnect = error?.code === 'reauthorization_required' || error?.code === 'calendar_not_connected';
      const reason = canReconnect ? 'Google Kalender behöver anslutas igen.' : error?.code === 'oauth_configuration_error' ? 'Kalenderns serveranslutning behöver ses över.' : 'Kalendern kunde inte uppdateras.';
      setStatus('stale', reason + ' ' + savedText() + ' Nya eller ändrade händelser kan saknas.', canReconnect);
    } finally {
      syncing = false; retry.disabled = false; refreshViews();
    }
  }
  retry.onclick = syncLiveCalendar;
  navigator.serviceWorker?.addEventListener('controllerchange', syncLiveCalendar);
  refreshViews(); syncLiveCalendar();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshViews(); syncLiveCalendar(); } });
})();
