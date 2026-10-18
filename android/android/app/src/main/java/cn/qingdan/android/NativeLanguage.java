package cn.qingdan.android;

import java.util.Locale;
import java.util.Map;
import java.util.Arrays;

/** UI-only language selection. Never changes task, note, account, or attachment data. */
public final class NativeLanguage {
    private static volatile String preference = "system";
    public interface Translator { String translate(String key, String locale); }
    private static volatile Translator translator = (key, locale) -> key;
    public static void setTranslator(Translator value) { if (value == null) throw new IllegalArgumentException("Missing translator"); translator = value; }
    private NativeLanguage() {}
    public static String[] choices() { return new String[]{"system", "zh-CN", "en", "zh-TW", "ja", "ko", "es", "fr", "de", "pt-BR"}; }
    public static String[] names() { return new String[]{text("language.system"), "简体中文", "English", "繁體中文", "日本語", "한국어", "Español", "Français", "Deutsch", "Português (Brasil)"}; }
    public static boolean validPreference(String value) { return value != null && Arrays.asList(choices()).contains(value); }
    public static String normalizePreference(String value) { return validPreference(value) ? value : "system"; }
    public static void setPreference(String value) {
        if (!validPreference(value)) throw new IllegalArgumentException(text("language.preference.invalid"));
        preference = value;
    }
    public static String preference() { return preference; }
    public static String resolveLocale(String value, Locale system) {
        if (validPreference(value) && !"system".equals(value)) return value;
        if (system == null) return "en";
        String language = system.getLanguage();
        if ("zh".equals(language)) return "Hans".equals(system.getScript()) ? "zh-CN" : "Hant".equals(system.getScript()) || Arrays.asList("TW", "HK", "MO").contains(system.getCountry()) ? "zh-TW" : "zh-CN";
        if ("pt".equals(language)) return "pt-BR";
        return validPreference(language) ? language : "en";
    }
    public static String locale() { return resolveLocale(preference, Locale.getDefault()); }
    public static String text(String key) { return translator.translate(key, locale()); }
    /** Bundled-page bootstrap; all interpolated values are closed-enum selections. */
    public static String bootstrapScript() {
        String value = preference(), resolved = locale();
        return "window.__QINGDAN_NATIVE_LANGUAGE__='" + value + "';window.__QINGDAN_NATIVE_LOCALE__='" + resolved
                + "';window.__QINGDAN_NATIVE_LANGUAGE_READY__=true;document.documentElement.lang='" + resolved
                + "';try{localStorage.setItem('qingdan-language','" + value + "')}catch(e){}";
    }
    /** No new bridge: caller must already verify the active, trusted top-level APK document. */
    public static String parseCommand(String url) {
        Map<String, String> query = ExportPayload.query(url, "language", 128);
        if (query.size() != 1 || !validPreference(query.get("preference"))) throw new IllegalArgumentException(text("language.preference.invalid"));
        return query.get("preference");
    }
}
