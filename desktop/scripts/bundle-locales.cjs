'use strict';
// Keep native bundle language negotiation aligned with the nine interface locales.
// Apple language-resource IDs use hyphens. Keep the legacy aliases as well.
// https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPInternational/LanguageandLocaleIDs/LanguageandLocaleIDs.html
const MAC_LOCALIZATIONS = Object.freeze(['en', 'zh-CN', 'zh-Hans', 'zh-TW', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'zh_CN', 'zh', 'zh_Hans', 'zh_TW', 'zh_Hant', 'pt_BR']);
function localizedBundleNames(englishDisplay, chineseDisplay) {
  const traditionalDisplay = chineseDisplay.replaceAll('青单', '青單').replaceAll('辅助程序', '輔助程式').replaceAll('图形', '圖形').replaceAll('插件', '外掛').replaceAll('渲染器', '算繪器');
  return MAC_LOCALIZATIONS.map(locale => [locale, ['zh-TW', 'zh-Hant', 'zh_TW', 'zh_Hant'].includes(locale) ? traditionalDisplay : ['zh-CN', 'zh-Hans', 'zh_CN', 'zh', 'zh_Hans'].includes(locale) ? chineseDisplay : englishDisplay]);
}
module.exports = { MAC_LOCALIZATIONS, localizedBundleNames };
