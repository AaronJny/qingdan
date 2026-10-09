package cn.qingdan.android;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** Run with javac/java without Android SDK; no mock Android behavior is claimed. */
public final class LocalStorePolicyTest {
    private static int checks;
    public static void main(String[] arguments) throws Exception {
        for (String key : new String[]{"local:0123/att:abc", "背景/图片.png", "plain", "emoji/😀"}) {
            LocalStorePolicy.validateObjectKey(key); checks++;
        }
        for (String key : new String[]{"", "/etc/passwd", "../x", "x/..", "x/./y", "x//y", "x/", "a\\b", "a\0b", "x\n", "x\u007f", "\ud800", "\udc00", "😀".repeat(257)}) {
            rejects(() -> LocalStorePolicy.validateObjectKey(key));
        }
        LocalStorePolicy.Sql read = LocalStorePolicy.inspectSql("/* safe */ SELECT ?, NULL, 1.5, 'semi; ? _qingdan_runtime' FROM records WHERE id=?;");
        check(read.hasRows && !read.returning && read.parameters == 2);
        check(LocalStorePolicy.inspectSql("SELECT '?', \"?\", ? FROM records").parameters == 1);
        LocalStorePolicy.Sql write = LocalStorePolicy.inspectSql("INSERT INTO records(id,data) SELECT ?,? WHERE changes()=1");
        check(!write.hasRows && write.parameters == 2);
        LocalStorePolicy.Sql returned = LocalStorePolicy.inspectSql("UPDATE records SET revision=revision+1 WHERE id=? RETURNING id,revision");
        check(returned.hasRows && returned.returning && returned.parameters == 1);
        LocalStorePolicy.Sql recursive = LocalStorePolicy.inspectSql("WITH RECURSIVE d(id) AS (SELECT id FROM records WHERE id=? UNION ALL SELECT r.id FROM records r JOIN d ON r.list_id=d.id) SELECT id FROM d");
        check(recursive.hasRows && recursive.parameters == 1);
        LocalStorePolicy.Sql cteWrite = LocalStorePolicy.inspectSql("WITH d(id) AS(SELECT id FROM records) UPDATE records SET deleted=1 WHERE id IN(SELECT id FROM d)");
        check(!cteWrite.hasRows);
        for (String sql : new String[]{"", ";", "SELECT 1; DELETE FROM records", "ATTACH DATABASE ? AS other", "PRAGMA journal_mode=OFF", "BEGIN", "COMMIT", "CREATE TABLE x(id)", "DROP TABLE records", "SELECT * FROM _qingdan_runtime", "DELETE FROM \"_qingdan_migrations\"", "SELECT * FROM `auth_users`", "SELECT * FROM 'auth_users'", "UPDATE '_qingdan_runtime' SET mode='local'", "SELECT * FROM [sqlite_master]", "SELECT load_extension(?)", "SELECT * FROM pragma_database_list", "SELECT readfile(?)", "SELECT writefile(?,?)", "SELECT ?1", "SELECT :named", "SELECT @named", "SELECT $named", "SELECT 'unterminated", "SELECT (1", "SELECT 1 /* unterminated", "SELECT 1\0"}) {
            rejects(() -> LocalStorePolicy.inspectSql(sql));
        }
        List<String> split = LocalStorePolicy.splitStatements("-- comment ;\nCREATE TABLE x(a TEXT);--> statement-breakpoint\nINSERT INTO x VALUES('a;''b'); /* comment ; */\nSELECT \"a;b\" FROM x; --tail");
        check(split.size() == 3);
        check(split.get(1).contains("'a;''b'"));
        if (arguments.length == 1) {
            int total = 0;
            try (var files = Files.list(Path.of(arguments[0]))) {
                for (Path path : files.filter(p -> p.toString().endsWith(".sql")).sorted().toList()) {
                    String sql = Files.readString(path);
                    List<String> statements = LocalStorePolicy.splitStatements(sql);
                    check(!statements.isEmpty()); total += statements.size();
                }
            }
            check(total == 24);
        }
        System.out.println("LocalStorePolicyTest passed: " + checks + " checks");
    }
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("Check " + checks + " failed"); }
    private static void rejects(Runnable action) { checks++; try { action.run(); } catch (IllegalArgumentException expected) { return; } throw new AssertionError("Rejection " + checks + " failed"); }
}
