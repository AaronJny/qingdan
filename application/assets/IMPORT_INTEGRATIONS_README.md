# Qingdan snapshot import and server integration utilities

These dependency-free TypeScript utilities support snapshot import/export and server-side provider adapters.

## Scope

- CSV and ICS utilities import and export one-time file snapshots.
- Server-only adapters provide OpenAI summary, task extraction and transcription requests, plus Google Calendar event operations. They require authentication and permission handling in the calling application; they do not provide a connected integration in the product interface.
- OAuth setup, token refresh, webhooks and background synchronization are outside this module. AI output must be reviewed before saving or acting on it.

## Tests

Run from `application/`:

```sh
node --experimental-strip-types --test assets/importers.test.ts assets/integrations.test.ts
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck --lib es2022,dom assets/importers.ts assets/importers.test.ts assets/integrations.ts assets/integrations.test.ts
```

Tests use `node:test` and mocked HTTP responses; they run without network access or provider credentials.

## Snapshot API

`parseCSV(input)` supports RFC4180 quoting, doubled quotes, commas, multiline text, empty fields, BOM, CRLF and LF. Malformed quotes reject the input. Input has a 10-million-character limit.

`stringifyCSV(rows, { spreadsheetSafe: true })` prefixes formula-like cells with a quote when exporting for spreadsheets. This changes data intentionally and is opt-in; raw serialization preserves data exactly.

`importTaskCSV(input)` returns `{ items, warnings }`. Required column: `title`. Supported columns: `id,title,description,date,time,priority,tags,list,section,parent_id,timezone,status,deadline,duration`. Priority is Qingdan 0 none, 1 low, 2 medium, 3 high. `date`/`deadline` must be real YYYY-MM-DD dates, `time` HH:mm or HH:mm:ss, `duration` nonnegative integral minutes up to 525600. Tags are a JSON string array or semicolon-delimited text. Status is open/done/wontdo. IDs may be generated; missing parents/cycles are warned and removed. Import `list` is a name, not an authenticated app list ID. The application must resolve it within the authorized workspace. Parent IDs must be remapped if application IDs change.

`exportTaskCSV(tasks, options)` writes all supported columns, using JSON arrays for lossless tags. Warnings must be surfaced rather than silently accepted.

`importTodoistCSV(input, { list })` understands documented TYPE task/section, CONTENT, DESCRIPTION, PRIORITY, INDENT, DATE, TIMEZONE, DURATION/DURATION_UNIT, DEADLINE. Section resets the hierarchy; indent 1..4 creates parent relationships. Todoist p1..p4 maps to Qingdan 3..0. Per current official documentation, a blank priority becomes p1. Labels encoded as whitespace-prefixed @labels are separated into tags. Only ISO date and optional local time are interpreted; natural-language and recurring dates are warned, never guessed. Comments, meta rows, author/responsible assignments, language hints, unknown columns and unsupported durations are not applied. It is not a Todoist API integration.

`importICS(input)` returns separate calendar snapshots (`CalendarSnapshot`), not generic tasks. It preserves DTSTART/DTEND with date, optional time, optional TZID, or UTC flag; DTEND is exclusive, including multiday all-day events. Floating wall times remain floating. Absent DTEND remains absent. SUMMARY, DESCRIPTION, LOCATION, CATEGORIES, STATUS and UID are preserved. Text escaping, content-line unfolding and UTF8-safe 75-octet export folding are supported. Duplicate UIDs warn because recurrence exceptions are not merged. Invalid events are skipped with explicit warnings; broken component structure rejects input.

`exportICS(events, { now })` returns `{ text, warnings }`. DTSTART/DTEND must share value type and timezone representation; cross-zone endpoints are unsupported. Named TZID wall times are preserved without UTC conversion. TZID export warns because it does not synthesize VTIMEZONE; receiving calendar software must understand that timezone ID. Recurrence (RRULE/RDATE/EXDATE/RECURRENCE-ID), VALARM, custom VTIMEZONE definitions and other unsupported properties warn and are not applied. Expansion/conversion must be supplied by a separate validated recurrence/timezone layer.

## Server integration API and security boundary

`createOpenAIAdapter({ token, model, transcriptionModel?, fetch?, timeoutMs? })`

- `summarizeTasks(tasks)` → short Chinese summary. Only declared title/description/dueDate/priority fields are transmitted; extra app metadata is dropped.
- `extractTasks(source, { today, timeZone })` → `{ tasks, warnings }`. Uses Responses strict JSON schema, then validates real dates, times, priorities, strings and array bounds. Handles refusal/incomplete responses explicitly.
- `transcribeAudio(blob, filename, language?)` → text. Multipart FormData with JSON response format, optional ISO639-1 language, nonempty supported-format audio up to 25 MiB. No streaming, translation, diarization, persistent microphone access or automatic task creation.
- `model` is explicitly supplied; compatible model availability and structured-output support are caller responsibilities. `transcriptionModel` is separate; the utility does not switch or upgrade paid models.
- Responses use `store:false`; this does not assert zero provider retention or bypass provider policies.

`createGoogleCalendarAdapter({ token, fetch?, timeoutMs? })`

- `listEvents(calendarId, query?)` → one page `{ items, nextPageToken?, nextSyncToken? }`. Caller must follow pages; sync tokens are surfaced as API data, no background sync is created. Cancelled-event tombstones are supported. Illegal time ranges, pagination sizes and sync-token combinations reject before a request. HTTP 410 surfaces SYNC_EXPIRED.
- `createEvent(calendarId, event)` → event. Supports summary, description, location, start, end. All-day end date is exclusive; timed endpoints require RFC3339 offset or named IANA timezone. Offsetless named-zone wall times are sent without resolving DST gaps/ambiguities; the application should resolve these when needed.
- `updateEvent(calendarId, eventId, patch, etag)` → event. Uses PATCH to retain omitted provider fields. Both start and end are required when changing the range. Mandatory If-Match prevents stale modification.
- `deleteEvent(calendarId, eventId, etag)` → void. Mandatory If-Match; accepts provider 204.
- Attendees, conferences, recurring-event mutations and arbitrary provider fields cannot be passed in the mutation schema. Mutations use `sendUpdates=none`; Google documents potential adverse external-calendar effects and that some emails can still occur. These are normal event methods, not the migration `events.import` method.

All factories and calls reject browser execution. Keep this module out of browser/client bundles. Tokens are supplied only by an authorized server credential store; this module never reads or writes environment secrets, returns tokens, logs provider bodies, scaffolds OAuth or exposes tokens to clients. Token refresh, permission checks, transmission consent, account isolation, rate limiting, request approval and operational audit logs belong in the calling server application. Fixed HTTPS provider origins and `redirect:error` avoid redirecting authorization headers. Errors contain only provider, stable code and optional HTTP status; provider body text and network exceptions are never exposed. Calls have bounded abort timeouts and no automatic mutation retries, to avoid duplicate writes.

## Official source coverage

- CSV grammar: RFC4180, https://www.rfc-editor.org/rfc/rfc4180
- ICS content lines, folding, TEXT escaping, VEVENT date/time and exclusive end semantics: RFC5545, https://www.rfc-editor.org/rfc/rfc5545
- Todoist project CSV columns, sections, priority, indent, language/timezone, duration/deadline: https://www.todoist.com/help/account-and-billing/security/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN
- OpenAI Responses input/text strict JSON schema and output text/refusal patterns: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI multipart transcription API and JSON response: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
- OpenAI file formats/size and transcription workflow: https://developers.openai.com/api/docs/guides/speech-to-text
- Google Calendar list endpoint, one-page tokens, maxResults, time filters, sync token constraints: https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Google Calendar create endpoint, exclusive end and timezone fields, sendUpdates behavior: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- Google Calendar partial update, preserving unmentioned fields: https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
- Google Calendar full update reference reviewed; PATCH chosen to avoid replacing unrelated fields: https://developers.google.com/workspace/calendar/api/v3/reference/events/update
- Google Calendar delete endpoint: https://developers.google.com/workspace/calendar/api/v3/reference/events/delete
- Google ETag/If-Match conditional modifications and 412 conflict: https://developers.google.com/workspace/calendar/api/guides/version-resources
