package cn.qingdan.android;

import android.content.Context;
import android.content.ContextWrapper;
import android.net.Uri;
import android.test.InstrumentationTestCase;
import android.webkit.WebResourceResponse;

import androidx.sqlite.SQLiteConnection;
import androidx.sqlite.SQLiteStatement;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

/** Device/emulator tests. They exercise the real bundled engine and app-private filesystem. */
@SuppressWarnings("deprecation")
public final class LocalStoreInstrumentedTest extends InstrumentationTestCase {
    private TestContext context;
    private LocalStore store;
    private String principal;

    @Override protected void setUp() throws Exception {
        super.setUp();
        Context target = getInstrumentation().getTargetContext();
        File root = new File(target.getCacheDir(), "qingdan-store-test-" + UUID.randomUUID());
        assertTrue(root.mkdir());
        context = new TestContext(target, root);
        store = new LocalStore(context);
        principal = call(new JSONObject().put("action", "info")).getJSONObject("result").getString("principalId");
    }
    @Override protected void tearDown() throws Exception {
        if (store != null) store.close();
        if (context != null) remove(context.root);
        super.tearDown();
    }

    public void testStableIdentityAndTypedBindings() throws Exception {
        assertTrue(principal.matches("local:[a-f0-9-]{36}"));
        JSONObject info = call(new JSONObject().put("action", "info")).getJSONObject("result");
        assertTrue(info.getString("csrfToken").matches("[a-f0-9]{64}"));
        store.close(); store = new LocalStore(context);
        assertEquals(principal, call(new JSONObject().put("action", "info")).getJSONObject("result").getString("principalId"));
        JSONObject row = batch(statement("SELECT typeof(?) n,typeof(?) s,typeof(?) i,typeof(?) f,? empty", JSONObject.NULL, "42", 42, 3.5, ""))
                .getJSONObject(0).getJSONArray("results").getJSONObject(0);
        assertEquals("null", row.getString("n")); assertEquals("text", row.getString("s"));
        assertEquals("integer", row.getString("i")); assertEquals("real", row.getString("f"));
        assertEquals("", row.getString("empty"));
    }

    public void testTransactionRollbackChangesAndReturning() throws Exception {
        JSONArray saved = batch(record("record1", "list"),
                statement("SELECT changes() observed"),
                statement("INSERT INTO operation_receipts(user_id,id,request_hash,result,created_at) SELECT ?,?,'hash','{}','now' WHERE changes()=1", principal, "receipt1"));
        assertEquals(1, saved.getJSONObject(0).getJSONObject("meta").getLong("changes"));
        assertEquals(0, saved.getJSONObject(1).getJSONObject("meta").getLong("changes"));
        assertEquals(1, saved.getJSONObject(1).getJSONArray("results").getJSONObject(0).getLong("observed"));
        assertEquals(1, saved.getJSONObject(2).getJSONObject("meta").getLong("changes"));
        JSONObject returned = batch(statement("UPDATE records SET revision=revision+1 WHERE id=? RETURNING id,revision", "record1")).getJSONObject(0);
        assertEquals(1, returned.getJSONObject("meta").getLong("changes"));
        assertEquals(2, returned.getJSONArray("results").getJSONObject(0).getLong("revision"));
        JSONObject failure = requestBatch(record("must-rollback", "list"), record("record1", "list"));
        assertFalse(failure.getBoolean("ok"));
        assertEquals(0, batch(statement("SELECT id FROM records WHERE id=?", "must-rollback")).getJSONObject(0).getJSONArray("results").length());
        assertFalse(requestBatch(statement("DELETE FROM _qingdan_runtime")).getBoolean("ok"));
        assertFalse(requestBatch(statement("ATTACH DATABASE ? AS accounts", "/tmp/accounts.db")).getBoolean("ok"));
    }

    public void testObjectsIntegrityAndAuthorizedBinaryRoutes() throws Exception {
        String key = principal + "/bg:test";
        byte[] bytes = new byte[]{(byte) 137, 80, 78, 71, 13, 10, 26, 10};
        JSONObject placed = call(new JSONObject().put("action", "objectPut").put("key", key)
                .put("mime", "image/png").put("data", Base64.getEncoder().encodeToString(bytes))).getJSONObject("result");
        assertEquals(bytes.length, placed.getInt("size")); assertTrue(placed.getString("sha256").matches("[a-f0-9]{64}"));
        JSONObject head = call(new JSONObject().put("action", "objectHead").put("key", key)).getJSONObject("result");
        assertFalse(head.has("data"));
        JSONObject read = call(new JSONObject().put("action", "objectGet").put("key", key)).getJSONObject("result");
        assertEquals(Base64.getEncoder().encodeToString(bytes), read.getString("data"));
        batch(record("countdown1", "countdown"), statement("INSERT INTO attachments(id,record_id,owner_id,name,mime,size,key,created_at) VALUES(?,?,?,?,?,?,?,?)",
                "bg:test", "countdown1", principal, "test.png", "image/png", bytes.length, key, "now"));
        WebResourceResponse response = store.interceptLocalApi(Uri.parse("https://local.qingdan.invalid/api/countdown-background?id=bg%3Atest"));
        assertEquals(200, response.getStatusCode()); assertEquals("image/png", response.getMimeType());
        assertEquals(137, response.getData().read()); response.getData().close();
        assertEquals(403, store.interceptLocalApi(Uri.parse("https://private.example/api/countdown-background?id=bg%3Atest")).getStatusCode());
        assertEquals(404, store.interceptLocalApi(Uri.parse("https://local.qingdan.invalid/api/countdown-background?id=bg%3Atest&id=other")).getStatusCode());
        batch(statement("UPDATE records SET owner_id=? WHERE id=?", "foreign", "countdown1"));
        assertEquals(404, store.interceptLocalApi(Uri.parse("https://local.qingdan.invalid/api/countdown-background?id=bg%3Atest")).getStatusCode());
        assertFalse(new JSONObject(store.invoke(new JSONObject().put("action", "objectPut").put("key", "../escape").put("data", "").toString())).getBoolean("ok"));
        File[] objects = new File(context.getFilesDir(), "local/objects").listFiles((dir, name) -> name.endsWith(".qobj"));
        assertNotNull(objects); assertEquals(1, objects.length);
        try (FileOutputStream append = new FileOutputStream(objects[0], true)) { append.write(1); }
        assertFalse(new JSONObject(store.invoke(new JSONObject().put("action", "objectGet").put("key", key).toString())).getBoolean("ok"));
    }

    public void testRejectsAccountMarkerAndChangedMigration() throws Exception {
        store.close(); store = null;
        try (SQLiteConnection db = new BundledSQLiteDriver().open(context.getDatabasePath("local.db").getPath())) {
            execute(db, "UPDATE _qingdan_runtime SET mode='accounts'");
        }
        try { store = new LocalStore(context); fail("Account marker was adopted"); }
        catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("account mode")); }
        assertTrue(context.getDatabasePath("local.db").isFile());
        try (SQLiteConnection db = new BundledSQLiteDriver().open(context.getDatabasePath("local.db").getPath())) {
            execute(db, "UPDATE _qingdan_runtime SET mode='local'");
            execute(db, "UPDATE _qingdan_migrations SET checksum='tampered' WHERE name='0000_empty_ares.sql'");
        }
        try { store = new LocalStore(context); fail("Changed migration was accepted"); }
        catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("migration has changed")); }
        assertTrue(context.getDatabasePath("local.db").isFile());
    }

    private JSONObject record(String id, String kind) throws Exception {
        return statement("INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)", id, principal, kind, "{\"title\":\"fixture\"}", "now");
    }
    private static JSONObject statement(String sql, Object... values) throws Exception {
        JSONArray bindings = new JSONArray(); for (Object value : values) bindings.put(value);
        return new JSONObject().put("sql", sql).put("values", bindings);
    }
    private JSONArray batch(JSONObject... statements) throws Exception {
        JSONObject response = requestBatch(statements);
        assertTrue(response.toString(), response.getBoolean("ok"));
        return response.getJSONArray("result");
    }
    private JSONObject requestBatch(JSONObject... statements) throws Exception {
        JSONArray array = new JSONArray(); for (JSONObject statement : statements) array.put(statement);
        return new JSONObject(store.invoke(new JSONObject().put("action", "batch").put("statements", array).toString()));
    }
    private JSONObject call(JSONObject request) throws Exception {
        JSONObject response = new JSONObject(store.invoke(request.toString()));
        assertTrue(response.toString(), response.getBoolean("ok")); return response;
    }
    private static void execute(SQLiteConnection db, String sql) {
        try (SQLiteStatement statement = db.prepare(sql)) { while (statement.step()) { } }
    }
    private static void remove(File root) {
        File[] children = root.listFiles(); if (children != null) for (File child : children) remove(child);
        if (!root.delete()) throw new AssertionError("Cannot clean isolated fixture: " + root);
    }
    private static final class TestContext extends ContextWrapper {
        final File root;
        TestContext(Context base, File root) { super(base); this.root = root; }
        @Override public Context getApplicationContext() { return this; }
        @Override public File getDatabasePath(String name) { return new File(new File(root, "databases"), name); }
        @Override public File getFilesDir() { return new File(root, "files"); }
    }
}
