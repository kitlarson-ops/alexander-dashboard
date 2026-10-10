const TERM_END = '2027-01-01T00:00:00+01:00';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cid = process.env.GOOGLE_CLIENT_ID, sec = process.env.GOOGLE_CLIENT_SECRET;
  const surl = process.env.SUPABASE_URL, skey = process.env.SUPABASE_SECRET_KEY;
  const fail = (status, code, error, reconnect = false) => res.status(status).json({
    error, code, ...(reconnect ? { connect: '/api/oauth/start' } : {})
  });
  if (!cid || !sec || !surl || !skey) return fail(503, 'configuration_missing', 'Server configuration missing');
  try {
    const dr = await fetch(surl + '/rest/v1/google_oauth_tokens?id=eq.alexander&select=refresh_token', {
      headers: { apikey: skey, authorization: 'Bearer ' + skey }, signal: AbortSignal.timeout(10000)
    });
    if (!dr.ok) return fail(503, 'token_store_unavailable', 'Calendar connection could not be checked');
    const rows = await dr.json();
    if (!Array.isArray(rows)) throw new Error('Invalid token store response');
    if (!rows[0]?.refresh_token) return fail(401, 'calendar_not_connected', 'Calendar not connected', true);
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cid, client_secret: sec, refresh_token: rows[0].refresh_token, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(10000)
    });
    const tok = await tr.json();
    if (!tr.ok) {
      // Return only allowlisted classifications, never Google's raw response or tokens.
      if (tok.error === 'invalid_grant') return fail(401, 'reauthorization_required', 'Google Calendar must be reconnected', true);
      if (tok.error === 'invalid_client' || tok.error === 'unauthorized_client') return fail(503, 'oauth_configuration_error', 'Google OAuth configuration needs attention');
      return fail(502, 'token_refresh_failed', 'Google token refresh failed');
    }
    if (!tok.access_token) throw new Error('Missing access token');
    const now = new Date();
    const auth = { authorization: 'Bearer ' + tok.access_token };
    const readPages = async (url, params = new URLSearchParams()) => {
      const items = [], seen = new Set();
      let pageToken;
      do {
        if (pageToken) params.set('pageToken', pageToken);
        const r = await fetch(url + '?' + params, { headers: auth, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('Calendar request failed');
        const data = await r.json();
        if (data.items !== undefined && !Array.isArray(data.items)) throw new Error('Invalid calendar response');
        items.push(...(data.items || []));
        pageToken = data.nextPageToken;
        if (pageToken && seen.has(pageToken)) throw new Error('Repeated calendar page');
        seen.add(pageToken);
      } while (pageToken);
      return items;
    };
    const calendars = await readPages('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    const alex = calendars.find(x => /alexander/i.test(x.summary || '') && /(personal|private)/i.test(x.summary || ''))
      || calendars.find(x => /alexander/i.test(x.summary || ''));
    if (!alex) return fail(404, 'calendar_not_found', 'Alexander calendar not found');
    const school = calendars.find(x => /^waldorf school$/i.test(x.summary || ''));
    if (!school) return fail(502, 'school_calendar_not_found', 'Waldorf School calendar not found; snapshot incomplete');
    const getEvents = async cal => {
      if (!cal || now >= new Date(TERM_END)) return [];
      const params = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(TERM_END).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeZone: 'Europe/Stockholm' });
      const items = await readPages('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) + '/events', params);
      return items.filter(e => e.status !== 'cancelled').map(e => ({
        id: e.id, iCalUID: e.iCalUID, title: e.summary || 'Kalenderhändelse',
        start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
        location: e.location || '', description: e.description || '', allDay: !!e.start?.date
      }));
    };
    const [events, schoolEvents] = await Promise.all([getEvents(alex), getEvents(school)]);
    return res.status(200).json({ calendar: alex.summary, events, schoolCalendar: school?.summary || null, schoolEvents, syncedAt: new Date().toISOString() });
  } catch {
    return fail(502, 'calendar_unavailable', 'Calendar request failed');
  }
}
