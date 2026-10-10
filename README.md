# Alexander Dashboard

Mobile-first personal dashboard for Alexander.

## Calendar sync and saved planning

`api/calendar.js` reads the existing Alexander token record and the existing
Google OAuth/Vercel configuration. It fetches every page from both Alexander
Personal and Waldorf School. A complete successful response includes `syncedAt`.
No credentials, OAuth permissions, database schema, or sharing settings are
changed by this repair.

`calendar-view.js` uses a single deduplicated event snapshot for Week, 4 Weeks,
Term, and School. On failure it retains the last complete successful snapshot on
that device. If none exists, it displays the previously published saved term
plan. Both are clearly labelled as saved and may be incomplete or outdated.
A successful empty calendar replaces old data rather than resurrecting fallback
events. The existing autumn 2026 term boundary is retained; no future term data
is inferred. Multi-day events remain visible until their exclusive end, with
Europe/Stockholm dates regardless of the device timezone.

The service worker caches the app shell only. API and OAuth requests never use
the shell cache, so a cached response cannot silently claim to be live. A unique
request query and required `syncedAt` also protect the first load while an old
service worker is being replaced.

## Reconnecting the dashboard

The dashboard connection is separate from any assistant's Calendar connector.
The original generic `Google token refresh failed` response does not establish
whether the grant expired, was revoked, or the app credentials are wrong.

The repaired endpoint returns safe classifications, without provider response
bodies or credential values:

- `reauthorization_required` or `calendar_not_connected`: the owner should open
  [the existing Google connection flow](https://alexander-dashboard.vercel.app/api/oauth/start),
  choose the intended Google account with access to both calendars, and review
  and approve the existing Calendar read-only consent. This requires the user's
  own authorization step. The callback stores the grant in the existing token
  record and returns to the dashboard. No secret should be pasted into chat.
- `oauth_configuration_error`: the project owner must verify the existing
  server-side Google OAuth client ID/secret and client configuration. Repeated
  account reconnection is not a verified fix for this error.
- `token_store_unavailable`, `calendar_unavailable`, or `token_refresh_failed`:
  retry after the service recovers, and diagnose server/provider health. These
  do not automatically require a new Google grant.
- `school_calendar_not_found` or `calendar_not_found`: verify the expected
  calendar names/access. The last complete snapshot is retained; missing
  calendars are not treated as a successful empty calendar.

After any approved repair/reconnection, require a successful `/api/calendar`
response and verify the actual events and live indicator in all calendar views.
Google grants for external apps left in Testing can expire after seven days;
check the Google Cloud consent configuration before assuming this is the cause.
See [Google's token-expiration documentation](https://developers.google.com/identity/protocols/oauth2#expiration).
Changing app publishing status or credentials is a separate owner action.

## Local checks

No build step or runtime package installation is required for this static app.
The focused model, API, DOM-harness, and service-worker tests use Node's built-in
runner (Node 24 matches the Vercel project):

```sh
node --test tests/calendar.test.cjs
node --check calendar-view.js
node --check api/calendar.js
node --check sw.js
```

An optional Playwright browser suite is in `tests/browser.cjs`. In an environment
with Playwright and Chromium already available, run `node tests/browser.cjs`.
Set `CHROMIUM_PATH` for a different installed browser, and `QA_OUTPUT_DIR` for
screenshots. It uses a local-only fixture API and does not contact Google or
production. Browser checks must pass in a usable browser environment before
claiming visual/end-to-end verification.
