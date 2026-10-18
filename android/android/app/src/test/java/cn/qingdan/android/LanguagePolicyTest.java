package cn.qingdan.android;
import java.util.Locale;
/** Pure Java checks for preference fallbacks and the existing URL-command boundary. */
public final class LanguagePolicyTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("Language check " + checks); }
    public static void main(String[] args) {
        check("zh-CN".equals(NativeLanguage.resolveLocale("system", Locale.SIMPLIFIED_CHINESE)));
        check("zh-CN".equals(NativeLanguage.resolveLocale("system", Locale.TRADITIONAL_CHINESE)));
        check("en".equals(NativeLanguage.resolveLocale("system", Locale.FRENCH)));
        check("en".equals(NativeLanguage.resolveLocale("system", null)));
        check("zh-CN".equals(NativeLanguage.resolveLocale("zh-CN", Locale.US)));
        check("en".equals(NativeLanguage.resolveLocale("en", Locale.CHINA)));
        check("system".equals(NativeLanguage.normalizePreference("invalid")));
        check("system".equals(NativeLanguage.normalizePreference(null)));
        for (String choice : new String[]{"system", "zh-CN", "en"}) {
            check(choice.equals(NativeLanguage.parseCommand("qingdanapp://language?preference=" + choice)));
            NativeLanguage.setPreference(choice); check(choice.equals(NativeLanguage.preference()));
            check(NativeLanguage.bootstrapScript().contains("localStorage.setItem('qingdan-language','" + choice + "')"));
            check(NativeLanguage.bootstrapScript().contains("window.__QINGDAN_NATIVE_LANGUAGE_READY__=true"));
        }
        for (String url : new String[]{"qingdanapp://language?preference=en&extra=x", "qingdanapp://language?preference=en&preference=zh-CN", "qingdanapp://language?preference=fr", "qingdanapp://language?preference=en%27", "https://language?preference=en", "qingdanapp://language/path?preference=en", "qingdanapp://language", "qingdanapp://user@language?preference=en"}) {
            try { NativeLanguage.parseCommand(url); throw new AssertionError("Accepted " + url); } catch (IllegalArgumentException expected) { checks++; }
        }
        try { NativeLanguage.setPreference("invalid"); throw new AssertionError("Accepted invalid preference"); } catch (IllegalArgumentException expected) { checks++; }
        check("en".equals(NativeLanguage.preference()));
        NativeLanguage.setTranslator((key, locale) -> locale + ":" + key);
        check("en:app.name".equals(NativeLanguage.text("app.name")));
        System.out.println("Language policy checks: " + checks);
    }
}
