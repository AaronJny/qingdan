'use strict';
const {t,getLocale}=require('./language.cjs');
const {UI_ORIGIN}=require('./policy.cjs');
const {CSP,escapeHtml}=require('./local-pages.cjs');
function recoveryPage(){
  const text=key=>escapeHtml(t('desktop.recovery.'+key));
  return `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${text('title')}</title><link rel="stylesheet" href="${UI_ORIGIN}/ui.css"><script src="${UI_ORIGIN}/i18next.js"></script><script src="${UI_ORIGIN}/native-language.js"></script></head><body><main><h1>${text('title')}</h1><p>${text('intro')}</p><p>${text('limits')}</p><p id="summary" role="status" aria-live="polite">${text('loading')}</p><p id="diagnostics"></p><div><button id="view" disabled>${text('view')}</button> <button id="export" disabled>${text('export')}</button></div><section id="candidates" aria-label="${text('candidates')}" hidden></section><button id="more" hidden>${text('more')}</button><p class="hint">${text('review')}</p><button id="continue" disabled>${text('continue')}</button><p id="message" role="status" aria-live="polite"></p><p class="hint">${text('later')}</p></main><script src="${UI_ORIGIN}/recovery.js"></script></body></html>`;
}
module.exports={recoveryPage};
