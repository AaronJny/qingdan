import 'i18next';
import type core from './locales/core.zh.json';
import type primary from './locales/ui-primary.zh.json';
import type secondary from './locales/ui-secondary.zh.json';
import type domain from './locales/domain.zh.json';
/** All bundled semantic keys are available to i18next's TypeScript API and React hook. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    keySeparator: false;
    nsSeparator: false;
    returnNull: false;
    resources: { translation: typeof core & typeof primary & typeof secondary & typeof domain };
  }
}
