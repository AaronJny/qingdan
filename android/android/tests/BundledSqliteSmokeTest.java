package cn.qingdan.android;

import androidx.sqlite.SQLiteConnection;
import androidx.sqlite.SQLiteStatement;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;

/** Independent real bundled-JVM engine check. Does not emulate or claim Android device coverage. */
public final class BundledSqliteSmokeTest {
    private static int checks;
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Pass the unchanged drizzle migration directory.");
        Path directory = Files.createTempDirectory("qingdan-bundled-sqlite-test-");
        Path file = directory.resolve("local.db");
        String principal = "local:" + UUID.randomUUID();
        String version;
        try {
            try (SQLiteConnection db = new BundledSQLiteDriver().open(file.toString())) {
                version = text(db, "SELECT sqlite_version()");
                check(text(db, "PRAGMA journal_mode=WAL").equals("wal"));
                execute(db, "PRAGMA synchronous=FULL"); check(number(db, "PRAGMA synchronous") == 2);
                execute(db, "PRAGMA foreign_keys=ON"); check(number(db, "PRAGMA foreign_keys") == 1);
                check(number(db, "SELECT json_extract('{\"ok\":1}', '$.ok')") == 1);
                execute(db, "BEGIN IMMEDIATE");
                execute(db, "CREATE TABLE _qingdan_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
                int migrations = 0;
                try (var files = Files.list(Path.of(args[0]))) {
                    for (Path migration : files.filter(p -> p.toString().endsWith(".sql")).sorted().toList()) {
                        byte[] bytes = Files.readAllBytes(migration);
                        for (String sql : LocalStorePolicy.splitStatements(Files.readString(migration))) execute(db, sql);
                        execute(db, "INSERT INTO _qingdan_migrations VALUES(?,?,?)", migration.getFileName().toString(),
                                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), "now");
                        migrations++;
                    }
                }
                check(migrations == 6); check(number(db, "SELECT count(*) FROM _qingdan_migrations") == 6);
                execute(db, "CREATE TABLE _qingdan_runtime(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN('local','accounts')),local_principal_id TEXT,created_at TEXT NOT NULL)");
                execute(db, "INSERT INTO _qingdan_runtime VALUES(1,'local',?,'now')", principal);
                execute(db, "COMMIT");
                try (SQLiteStatement typed = db.prepare("SELECT typeof(?),typeof(?),typeof(?),typeof(?),?")) {
                    typed.bindNull(1); typed.bindText(2, "42"); typed.bindLong(3, 42); typed.bindDouble(4, 3.5); typed.bindText(5, "");
                    check(typed.step()); check(typed.getText(0).equals("null")); check(typed.getText(1).equals("text"));
                    check(typed.getText(2).equals("integer")); check(typed.getText(3).equals("real")); check(typed.getText(4).isEmpty()); check(!typed.step());
                }
                execute(db, "BEGIN IMMEDIATE");
                execute(db, "INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,'list','{\"title\":\"fixture\"}','now')", "record1", principal);
                check(number(db, "SELECT changes()") == 1);
                check(number(db, "SELECT last_insert_rowid()") > 0);
                execute(db, "INSERT INTO operation_receipts(user_id,id,request_hash,result,created_at) SELECT ?,?,'hash','{}','now' WHERE changes()=1", principal, "receipt1");
                check(number(db, "SELECT changes()") == 1);
                execute(db, "COMMIT");
                check(number(db, "SELECT count(*) FROM operation_receipts") == 1);
                execute(db, "BEGIN IMMEDIATE");
                execute(db, "INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,'list','{}','now')", "rollback", principal);
                try {
                    execute(db, "INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,'list','{}','now')", "record1", principal);
                    throw new AssertionError("Duplicate mutation should fail");
                } catch (androidx.sqlite.SQLiteException expected) { checks++; execute(db, "ROLLBACK"); }
                check(number(db, "SELECT count(*) FROM records WHERE id='rollback'") == 0);
                execute(db, "BEGIN IMMEDIATE");
                long before = number(db, "SELECT total_changes()");
                try (SQLiteStatement returned = db.prepare("UPDATE records SET revision=revision+1 WHERE id=? RETURNING id,revision")) {
                    returned.bindText(1, "record1"); check(returned.step()); check(returned.getText(0).equals("record1"));
                    check(returned.getLong(1) == 2); check(!returned.step());
                }
                check(number(db, "SELECT total_changes()") == before + 1); check(number(db, "SELECT changes()") == 1);
                execute(db, "COMMIT");
                execute(db, "INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,'focus','{\"focusStatus\":\"running\"}','now')", "focus1", principal);
                try {
                    execute(db, "INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,'focus','{\"focusStatus\":\"paused\"}','now')", "focus2", principal);
                    throw new AssertionError("JSON partial index should reject duplicate focus");
                } catch (androidx.sqlite.SQLiteException expected) { checks++; }
                check(number(db, "SELECT count(*) FROM records WHERE kind='focus'") == 1);
            }
            try (SQLiteConnection reopened = new BundledSQLiteDriver().open(file.toString())) {
                check(text(reopened, "SELECT local_principal_id FROM _qingdan_runtime WHERE id=1").equals(principal));
                check(number(reopened, "SELECT revision FROM records WHERE id='record1'") == 2);
                check(text(reopened, "PRAGMA integrity_check").equals("ok"));
            }
            System.out.println("BundledSqliteSmokeTest passed: " + checks + " checks; real bundled SQLite " + version);
        } finally {
            try (var paths = Files.walk(directory)) { for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path); }
        }
    }
    private static void execute(SQLiteConnection db, String sql, Object... values) {
        try (SQLiteStatement statement = db.prepare(sql)) {
            for (int i = 0; i < values.length; i++) {
                Object value = values[i];
                if (value == null) statement.bindNull(i + 1);
                else if (value instanceof String) statement.bindText(i + 1, (String) value);
                else if (value instanceof Long || value instanceof Integer) statement.bindLong(i + 1, ((Number) value).longValue());
                else throw new AssertionError("Unexpected test binding");
            }
            while (statement.step()) { }
        }
    }
    private static long number(SQLiteConnection db, String sql) { try (SQLiteStatement statement = db.prepare(sql)) { if (!statement.step()) throw new AssertionError("No scalar"); return statement.getLong(0); } }
    private static String text(SQLiteConnection db, String sql) { try (SQLiteStatement statement = db.prepare(sql)) { if (!statement.step()) throw new AssertionError("No scalar"); return statement.getText(0); } }
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("Check " + checks + " failed"); }
}
