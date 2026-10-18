'use strict';
const {t,getLocale,snapshot}=require('./language.cjs');
const {UI_ORIGIN}=require('./policy.cjs');
const {CSP,escapeHtml}=require('./local-pages.cjs');
function recoveryPage(){
  const text=key=>escapeHtml(t('desktop.recovery.'+key));
  return `<!doctype html><html lang="${getLocale()}" data-language-revision="${snapshot().revision}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${text('title')}</title><link rel="stylesheet" href="${UI_ORIGIN}/ui.css"><script src="${UI_ORIGIN}/i18next.js"></script><script src="${UI_ORIGIN}/native-language.js"></script></head><body><main><h1 data-recovery-text="title">${text('title')}</h1><p data-recovery-text="intro">${text('intro')}</p><p data-recovery-text="limits">${text('limits')}</p><p id="summary" role="status" aria-live="polite">${text('loading')}</p><p id="diagnostics"></p><div><button id="view" disabled data-recovery-text="view">${text('view')}</button> <button id="export" disabled data-recovery-text="export">${text('export')}</button></div><section id="candidates" aria-label="${text('candidates')}" hidden></section><button id="more" hidden data-recovery-text="more">${text('more')}</button><p class="hint" data-recovery-text="review">${text('review')}</p><button id="continue" disabled data-recovery-text="continue">${text('continue')}</button><p id="message" role="status" aria-live="polite"></p><p class="hint" data-recovery-text="later">${text('later')}</p></main><script src="${UI_ORIGIN}/recovery.js"></script></body></html>`;
}
module.exports={recoveryPage};
