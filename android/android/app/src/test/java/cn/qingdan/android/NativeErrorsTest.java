package cn.qingdan.android;
public final class NativeErrorsTest {
    public static void main(String[] args) {
        NativeLanguage.setPreference("en");
        NativeLanguage.setTranslator((key, locale) -> locale + ":" + key);
        String conflict = NativeErrors.storageMessage("SQLite error 2067: UNIQUE constraint failed: private_table.private_column");
        if (!"UNIQUE constraint failed".equals(conflict)) throw new AssertionError("Conflict/replay machine marker changed");
        if (!"en:storage.error.object.exceeds.25.mib".equals(NativeErrors.storageMessage("Object exceeds 25 MiB."))) throw new AssertionError("Known storage error was not localized");
        if (!"en:storage.operation.failed".equals(NativeErrors.storageMessage("/private/diagnostic/value"))) throw new AssertionError("Unknown diagnostic escaped");
        if (!"en:storage.operation.failed".equals(NativeErrors.storageMessage(null))) throw new AssertionError("Null diagnostic fallback failed");
        System.out.println("Native error checks: 4");
    }
}
