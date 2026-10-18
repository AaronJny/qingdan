# Interface languages

Qingdan bundles Simplified Chinese (`zh-CN`) and English (`en`) with i18next and react-i18next. No translation service or remote resource loader is used.

## Resources and call sites

- `application/lib/locales/` contains semantic-key dictionaries for the primary UI, secondary UI, domain presentation and known errors.
- Use typed `t('settings.language')` calls and named interpolation parameters. Keep complete sentences together; use i18next `_one` and `_other` resources with a numeric `count` for plurals.
- `lib/i18n-react.tsx` subscribes React components without remounting their input state. Memoized display strings must depend on the current locale.
- `Intl.DateTimeFormat` and `Intl.NumberFormat` format display values. Dates stored as `YYYY-MM-DD`, API fields, parser tokens and import/export formats stay canonical.
- Android retains its independent business-code baseline. Its corresponding resources and shared locale helpers are checked byte-for-byte against the main application by `npm run test:i18n`.

`translateError` is a compatibility boundary for known application-owned API errors and transient status strings. New UI text uses semantic IDs. Never pass task titles, notes, labels, comments, attachment names or other user content through that boundary.

## Preference and native hosts

The preference is `system`, `zh-CN` or `en`; first launch uses `system`. The first system language selects Chinese when it is a Chinese locale and English otherwise. A manual choice is local to the browser or device and does not create a synchronized settings record.

The browser persists `qingdan-language` in local storage. A storage failure keeps the current choice and displays a persistence notice. Electron persists an atomically written host preference and broadcasts revisioned snapshots to trusted windows. Stale reads and acknowledgements cannot overwrite a newer native choice. Android persists its host preference, uses localized Android resources, and seeds each trusted WebView before its application module starts.

Existing record bytes and schema migrations are unchanged. An untouched built-in Inbox can have a localized display label; a renamed Inbox and all user-created names remain exactly as saved. Sample content is created in the selected language only when the user explicitly adds it.

## Checks

Run the main application’s `npm run check`, desktop `npm run check`, Android `npm run test:android` and `npm run build:web`, plus the Android webapp’s pure/UI test suites. Locale checks cover key and interpolation parity, explicit call-site keys, fallback, preference persistence, native races, live-switch drafts, plural counts and canonical user data. Native packaging and signed APK checks run in the release workflow.
