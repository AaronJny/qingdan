package cn.qingdan.android;

import android.content.Context;
import android.content.res.AssetManager;
import android.net.Uri;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;

import androidx.sqlite.SQLiteConnection;
import androidx.sqlite.SQLiteStatement;
import androidx.sqlite.driver.bundled.BundledSQLiteDriver;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * App-private local-mode store. Attach only to the reserved, bundled local origin;
 * the host must never attach this bridge to a private-server WebView or subframe.
 * All entry points are serialized, and each SQL batch uses one IMMEDIATE transaction.
 * The single bundled connection is never used concurrently and never pools handles.
 */
public final class LocalStore implements AutoCloseable {
    private static final int MAX_REQUEST_CHARS = 40 * 1024 * 1024;
    private static final int MAX_RESULT_CHARS = 32 * 1024 * 1024;
    private static final int MAX_BATCH = 12000; // Full restore: 1000 records + 10000 histories + files.
    private static final int MAX_ROWS = 50000;
    private static final int MAX_HEADER_BYTES = 64 * 1024;
    private final LocalDatabase database;
    private final File objectDirectory;
    private final String principalId;
    private final String csrfToken;
    private boolean closed;

    public LocalStore(Context context) {
        LocalDatabase opened = null;
        try {
            Context app = context.getApplicationContext();
            File databaseFile = app.getDatabasePath("local.db");
            secureDirectory(databaseFile.getParentFile());
            rejectSymlink(databaseFile);
            rejectSymlink(new File(databaseFile.getPath() + "-wal"));
            rejectSymlink(new File(databaseFile.getPath() + "-shm"));
            rejectSymlink(new File(databaseFile.getPath() + "-journal"));
            secureDirectory(app.getFilesDir());
            File localDirectory = new File(app.getFilesDir(), "local");
            secureDirectory(localDirectory);
            objectDirectory = new File(localDirectory, "objects");
            secureDirectory(objectDirectory);
            String[] objectNames = objectDirectory.list();
            if (objectNames == null) throw new IOException("Cannot inspect local object storage.");
            for (String name : objectNames) rejectSymlink(new File(objectDirectory, name));
            final boolean hasObjects = objectNames.length != 0;
            // Bundled SQLite gives every supported Android version the same JSON/RETURNING runtime.
            // No Android corruption callback is installed: damaged files are preserved for recovery.
            opened = new LocalDatabase(new BundledSQLiteDriver().open(databaseFile.getPath()));
            database = opened;
            database.execSQL("PRAGMA busy_timeout=5000");
            try (RowCursor wal = database.rawQuery("PRAGMA journal_mode=WAL", null)) {
                if (!wal.moveToFirst() || !"wal".equalsIgnoreCase(wal.getString(0))) throw new IllegalStateException("Local database requires WAL.");
            }
            database.execSQL("PRAGMA synchronous=FULL");
            database.execSQL("PRAGMA foreign_keys=ON");
            String identity;
            database.beginTransactionNonExclusive();
            try {
                if (scalarLong("PRAGMA synchronous") != 2) throw new IllegalStateException("Local database requires synchronous=FULL.");
                checkJsonRuntime();
                preflightMode(hasObjects);
                migrate(app.getAssets());
                identity = initializeIdentity(hasObjects);
                seedLocalUser(identity);
                database.setTransactionSuccessful();
            } finally { database.endTransaction(); }
            principalId = identity;
            byte[] token = new byte[32];
            new SecureRandom().nextBytes(token);
            csrfToken = hex(token);
        } catch (Exception | LinkageError error) {
            if (opened != null) opened.close();
            throw new IllegalStateException("Cannot open local Qingdan storage: " + message(error), error);
        }
    }

    @JavascriptInterface
    public synchronized String invoke(String json) {
        try {
            ensureOpen();
            if (json == null || json.length() > MAX_REQUEST_CHARS) throw new IllegalArgumentException("Local request is too large.");
            JSONObject request = new JSONObject(json);
            String action = string(request, "action");
            Object result;
            switch (action) {
                case "info":
                    result = new JSONObject().put("principalId", principalId).put("csrfToken", csrfToken)
                            .put("mode", "local").put("version", "1.0.1");
                    break;
                case "batch": result = batch(request.getJSONArray("statements")); break;
                case "objectGet": result = objectResult(readObject(string(request, "key"), true), true); break;
                case "objectHead": result = objectResult(readObject(string(request, "key"), false), false); break;
                case "objectPut": result = putObject(request); break;
                case "objectDelete": deleteObject(string(request, "key")); result = JSONObject.NULL; break;
                default: throw new IllegalArgumentException("Unsupported local action.");
            }
            return new JSONObject().put("ok", true).put("result", result).toString();
        } catch (Exception error) {
            try { return new JSONObject().put("ok", false).put("error", message(error)).toString(); }
            catch (JSONException impossible) { return "{\"ok\":false,\"error\":\"Local storage failed.\"}"; }
        }
    }

    private JSONArray batch(JSONArray statements) throws Exception {
        if (statements.length() > MAX_BATCH) throw new IllegalArgumentException("Local batch is too large.");
        List<LocalStorePolicy.Sql> queries = new ArrayList<>();
        List<JSONArray> bindings = new ArrayList<>();
        // Validate the whole batch before starting any SQL work.
        for (int i = 0; i < statements.length(); i++) {
            JSONObject item = statements.getJSONObject(i);
            LocalStorePolicy.Sql query = LocalStorePolicy.inspectSql(string(item, "sql"));
            JSONArray values = item.has("values") ? item.getJSONArray("values") : new JSONArray();
            if (query.parameters != values.length()) throw new IllegalArgumentException("SQL parameter count does not match values.");
            for (int j = 0; j < values.length(); j++) validateValue(values.get(j));
            queries.add(query); bindings.add(values);
        }
        JSONArray result = new JSONArray();
        database.beginTransactionNonExclusive();
        try {
            int resultChars = 0;
            for (int i = 0; i < queries.size(); i++) {
                LocalStorePolicy.Sql query = queries.get(i);
                long started = System.nanoTime();
                JSONArray rows = new JSONArray();
                long changes = 0, lastId = 0;
                long before = query.returning ? scalarLong("SELECT total_changes()") : 0;
                if (query.hasRows) rows = readRows(query.statement, bindings.get(i));
                else {
                    try (SQLiteStatement statement = database.compileStatement(query.statement)) {
                        bind(statement, bindings.get(i));
                        if (statement.step()) throw new IllegalArgumentException("Unexpected SQL result rows.");
                    }
                }
                if (!query.hasRows || (query.returning && scalarLong("SELECT total_changes()") > before)) {
                    // Metadata SELECTs never reset changes(); the next guarded DML sees the previous write.
                    try (RowCursor metadata = database.rawQuery("SELECT changes(), last_insert_rowid()", null)) {
                        if (!metadata.moveToFirst()) throw new IllegalStateException("Cannot read SQL metadata.");
                        changes = metadata.getLong(0); lastId = metadata.getLong(1);
                    }
                }
                JSONObject meta = new JSONObject().put("changes", changes).put("last_row_id", lastId)
                        .put("duration", (System.nanoTime() - started) / 1_000_000.0)
                        .put("rows_read", rows.length()).put("rows_written", changes);
                JSONObject item = new JSONObject().put("success", true).put("results", rows).put("meta", meta);
                resultChars += item.toString().length();
                if (resultChars > MAX_RESULT_CHARS) throw new IllegalArgumentException("SQL results exceed the local response budget.");
                result.put(item);
            }
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
        return result;
    }

    private JSONArray readRows(String sql, JSONArray values) throws JSONException {
        JSONArray result = new JSONArray();
        try (SQLiteStatement statement = database.compileStatement(sql)) {
            bind(statement, values);
            RowCursor cursor = new RowCursor(statement);
            String[] names = cursor.getColumnNames();
            int chars = 0;
            while (cursor.moveToNext()) {
                if (result.length() >= MAX_ROWS) throw new IllegalArgumentException("SQL result contains too many rows.");
                JSONObject row = new JSONObject();
                for (int i = 0; i < names.length; i++) {
                    Object value;
                    switch (cursor.getType(i)) {
                        case RowCursor.FIELD_TYPE_NULL: value = JSONObject.NULL; break;
                        case RowCursor.FIELD_TYPE_INTEGER: value = cursor.getLong(i); break;
                        case RowCursor.FIELD_TYPE_FLOAT: value = cursor.getDouble(i); break;
                        case RowCursor.FIELD_TYPE_BLOB: value = Base64.getEncoder().encodeToString(cursor.getBlob(i)); break;
                        default: value = cursor.getString(i); break;
                    }
                    row.put(names[i], value);
                }
                chars += row.toString().length();
                if (chars > MAX_RESULT_CHARS) throw new IllegalArgumentException("SQL result exceeds the local response budget.");
                result.put(row);
            }
        }
        return result;
    }

    private static void validateValue(Object value) {
        if (value == JSONObject.NULL || value instanceof String) return;
        if (value instanceof Number && Double.isFinite(((Number) value).doubleValue())) return;
        throw new IllegalArgumentException("SQL values must be strings, finite numbers or null.");
    }

    private static void bind(SQLiteStatement program, JSONArray values) throws JSONException {
        for (int i = 0; i < values.length(); i++) {
            Object value = values.get(i);
            if (value == JSONObject.NULL) program.bindNull(i + 1);
            else if (value instanceof String) program.bindText(i + 1, (String) value);
            else if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
                program.bindLong(i + 1, ((Number) value).longValue());
            } else if (value instanceof Number && Double.isFinite(((Number) value).doubleValue())) {
                program.bindDouble(i + 1, ((Number) value).doubleValue());
            } else throw new IllegalArgumentException("Invalid SQL value.");
        }
    }

    private void checkJsonRuntime() {
        try (RowCursor check = database.rawQuery("SELECT json_valid('{\"ok\":1}'), json_extract('{\"ok\":1}', '$.ok')", null)) {
            if (!check.moveToFirst() || check.getInt(0) != 1 || check.getInt(1) != 1) throw new IllegalStateException("JSON functions returned invalid results.");
        } catch (RuntimeException error) {
            throw new IllegalStateException("The bundled SQLite runtime lacks required JSON functions. Local data has not been adopted.", error);
        }
    }

    private void preflightMode(boolean hasObjects) {
        if (tableExists("_qingdan_runtime")) {
            try (RowCursor runtime = database.rawQuery("SELECT mode, local_principal_id FROM _qingdan_runtime WHERE id=1", null)) {
                if (runtime.moveToFirst()) { validateIdentity(runtime.getString(0), runtime.getString(1)); return; }
            }
        }
        assertUnmarkedEmpty(hasObjects);
    }

    private void assertUnmarkedEmpty(boolean hasObjects) {
        if (hasObjects) throw new IllegalStateException("Stored files have no verified local mode marker. Restore or import explicitly.");
        try (RowCursor tables = database.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_qingdan_migrations','_qingdan_runtime')", null)) {
            while (tables.moveToNext()) {
                String escaped = tables.getString(0).replace("\"", "\"\"");
                try (RowCursor rows = database.rawQuery("SELECT 1 FROM \"" + escaped + "\" LIMIT 1", null)) {
                    if (rows.moveToFirst()) throw new IllegalStateException("Existing data has no verified mode marker. Automatic adoption is blocked; export/import into a new local store.");
                }
            }
        }
    }

    private String initializeIdentity(boolean hasObjects) {
        database.execSQL("CREATE TABLE IF NOT EXISTS _qingdan_runtime (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('local','accounts')), local_principal_id TEXT, created_at TEXT NOT NULL)");
        try (RowCursor runtime = database.rawQuery("SELECT mode, local_principal_id FROM _qingdan_runtime WHERE id=1", null)) {
            if (runtime.moveToFirst()) {
                String id = runtime.getString(1); validateIdentity(runtime.getString(0), id); return id;
            }
        }
        assertUnmarkedEmpty(hasObjects);
        String id = "local:" + UUID.randomUUID();
        database.execSQL("INSERT INTO _qingdan_runtime(id,mode,local_principal_id,created_at) VALUES(1,'local',?,?)", new Object[]{id, Instant.now().toString()});
        return id;
    }

    private static void validateIdentity(String mode, String id) {
        if (!"local".equals(mode)) throw new IllegalStateException("This database belongs to account mode and cannot be opened as local mode.");
        if (id == null || !id.matches("local:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")) {
            throw new IllegalStateException("Local identity metadata is invalid. Restore a verified backup.");
        }
    }

    private void seedLocalUser(String id) {
        // This is an identity label only, never an account/password or login session.
        try (RowCursor other = database.rawQuery("SELECT 1 FROM auth_users WHERE user_id<>? LIMIT 1", new String[]{id})) {
            if (other.moveToFirst()) throw new IllegalStateException("Account users cannot be adopted by a local store.");
        }
        if (scalarLong("SELECT count(*) FROM auth_sessions") != 0) throw new IllegalStateException("Account sessions cannot be adopted by a local store.");
        database.execSQL("INSERT OR IGNORE INTO auth_users(user_id,email,display_name,password_hash,role,disabled,created_at) VALUES(?,'local@qingdan.invalid','本地用户','!local-mode-no-login','admin',0,?)", new Object[]{id, System.currentTimeMillis()});
        try (RowCursor user = database.rawQuery("SELECT email,password_hash,role,disabled FROM auth_users WHERE user_id=?", new String[]{id})) {
            if (!user.moveToFirst() || !"local@qingdan.invalid".equals(user.getString(0))
                    || !"!local-mode-no-login".equals(user.getString(1)) || !"admin".equals(user.getString(2))
                    || user.getInt(3) != 0) throw new IllegalStateException("Local identity must not contain a password-enabled account.");
        }
    }

    private void migrate(AssetManager assets) throws Exception {
        String[] listed = assets.list("migrations");
        if (listed == null) throw new IOException("No bundled migrations found.");
        List<String> files = new ArrayList<>();
        for (String name : listed) if (name.matches("[0-9]{4}_[A-Za-z0-9_-]+\\.sql")) files.add(name);
        if (files.isEmpty()) throw new IOException("No bundled migrations found.");
        java.util.Collections.sort(files);
        database.execSQL("CREATE TABLE IF NOT EXISTS _qingdan_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
        Set<String> available = new HashSet<>(files);
        try (RowCursor applied = database.rawQuery("SELECT name FROM _qingdan_migrations", null)) {
            while (applied.moveToNext()) if (!available.contains(applied.getString(0))) throw new IllegalStateException("Previously applied migration is missing: " + applied.getString(0));
        }
        for (String name : files) {
            byte[] bytes;
            try (InputStream input = assets.open("migrations/" + name)) { bytes = readBounded(input, 2 * 1024 * 1024); }
            String checksum = hex(MessageDigest.getInstance("SHA-256").digest(bytes));
            boolean found = false;
            try (RowCursor prior = database.rawQuery("SELECT checksum FROM _qingdan_migrations WHERE name=?", new String[]{name})) {
                if (prior.moveToFirst()) {
                    found = true;
                    if (!checksum.equals(prior.getString(0))) throw new IllegalStateException("Applied migration has changed: " + name);
                }
            }
            if (!found) {
                String sql = new String(bytes, StandardCharsets.UTF_8);
                for (String statement : LocalStorePolicy.splitStatements(sql)) database.execSQL(statement);
                database.execSQL("INSERT INTO _qingdan_migrations(name,checksum,applied_at) VALUES(?,?,?)", new Object[]{name, checksum, Instant.now().toString()});
            }
        }
    }

    private boolean tableExists(String name) {
        try (RowCursor result = database.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", new String[]{name})) { return result.moveToFirst(); }
    }

    private long scalarLong(String sql) {
        try (RowCursor result = database.rawQuery(sql, null)) {
            if (!result.moveToFirst()) throw new IllegalStateException("SQL scalar result is missing.");
            return result.getLong(0);
        }
    }

    /** Small synchronous adapter, deliberately one connection with no Android CursorWindow. */
    private static final class LocalDatabase implements AutoCloseable {
        final SQLiteConnection connection;
        private boolean transaction;
        private boolean successful;
        LocalDatabase(SQLiteConnection connection) { this.connection = connection; }
        SQLiteStatement compileStatement(String sql) { return connection.prepare(sql); }
        void execSQL(String sql) { execSQL(sql, new Object[0]); }
        void execSQL(String sql, Object[] values) {
            try (SQLiteStatement statement = connection.prepare(sql)) {
                for (int i = 0; i < values.length; i++) {
                    Object value = values[i];
                    if (value == null) statement.bindNull(i + 1);
                    else if (value instanceof String) statement.bindText(i + 1, (String) value);
                    else if (value instanceof Long || value instanceof Integer) statement.bindLong(i + 1, ((Number) value).longValue());
                    else if (value instanceof Number) statement.bindDouble(i + 1, ((Number) value).doubleValue());
                    else throw new IllegalArgumentException("Invalid internal SQL binding.");
                }
                while (statement.step()) { /* Drain result-bearing PRAGMAs exactly once. */ }
            }
        }
        RowCursor rawQuery(String sql, String[] values) {
            SQLiteStatement statement = connection.prepare(sql);
            try {
                if (values != null) for (int i = 0; i < values.length; i++) {
                    if (values[i] == null) statement.bindNull(i + 1); else statement.bindText(i + 1, values[i]);
                }
                return new RowCursor(statement);
            } catch (RuntimeException error) { statement.close(); throw error; }
        }
        void beginTransactionNonExclusive() {
            if (transaction) throw new IllegalStateException("Nested local transactions are not supported.");
            execSQL("BEGIN IMMEDIATE"); transaction = true; successful = false;
        }
        void setTransactionSuccessful() {
            if (!transaction) throw new IllegalStateException("No local transaction.");
            successful = true;
        }
        void endTransaction() {
            if (!transaction) throw new IllegalStateException("No local transaction.");
            try {
                execSQL(successful ? "COMMIT" : "ROLLBACK");
            } catch (RuntimeException failure) {
                if (successful) try { execSQL("ROLLBACK"); } catch (RuntimeException rollback) { failure.addSuppressed(rollback); }
                throw failure;
            } finally { transaction = false; successful = false; }
        }
        @Override public void close() { connection.close(); }
    }
    private static final class RowCursor implements AutoCloseable {
        static final int FIELD_TYPE_INTEGER = 1, FIELD_TYPE_FLOAT = 2, FIELD_TYPE_STRING = 3,
                FIELD_TYPE_BLOB = 4, FIELD_TYPE_NULL = 5;
        final SQLiteStatement statement;
        private boolean started;
        RowCursor(SQLiteStatement statement) { this.statement = statement; }
        boolean moveToFirst() {
            if (started) throw new IllegalStateException("Cannot rewind a local statement.");
            return moveToNext();
        }
        boolean moveToNext() { started = true; return statement.step(); }
        String[] getColumnNames() {
            String[] names = new String[statement.getColumnCount()];
            for (int i = 0; i < names.length; i++) names[i] = statement.getColumnName(i);
            return names;
        }
        String getString(int column) { return statement.isNull(column) ? null : statement.getText(column); }
        int getInt(int column) { return (int) statement.getLong(column); }
        long getLong(int column) { return statement.getLong(column); }
        double getDouble(int column) { return statement.getDouble(column); }
        byte[] getBlob(int column) { return statement.getBlob(column); }
        int getType(int column) { return statement.getColumnType(column); }
        @Override public void close() { statement.close(); }
    }

    private static final class StoredObject {
        final JSONObject metadata;
        final byte[] bytes;
        StoredObject(JSONObject metadata, byte[] bytes) { this.metadata = metadata; this.bytes = bytes; }
    }

    private File objectFile(String key) throws Exception {
        LocalStorePolicy.validateObjectKey(key);
        rejectSymlink(objectDirectory.getParentFile().getParentFile());
        rejectSymlink(objectDirectory.getParentFile());
        rejectSymlink(objectDirectory);
        return new File(objectDirectory, hex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8))) + ".qobj");
    }

    private StoredObject readObject(String key, boolean includeBytes) throws Exception {
        File file = objectFile(key);
        FileDescriptor fd;
        try { fd = Os.open(file.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_CLOEXEC, 0); }
        catch (ErrnoException error) { if (error.errno == OsConstants.ENOENT) return null; throw error; }
        try (DataInputStream input = new DataInputStream(new FileInputStream(fd))) {
            StructStat stat = Os.fstat(fd);
            if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size < 4 || stat.st_size > LocalStorePolicy.MAX_OBJECT_BYTES + MAX_HEADER_BYTES + 4L) throw new IOException("Stored object size or type is invalid.");
            int headerSize = input.readInt();
            if (headerSize < 2 || headerSize > MAX_HEADER_BYTES || headerSize + 4L > stat.st_size) throw new IOException("Stored object metadata is invalid.");
            byte[] header = new byte[headerSize]; input.readFully(header);
            JSONObject metadata = new JSONObject(new String(header, StandardCharsets.UTF_8));
            long size = stat.st_size - headerSize - 4;
            if (metadata.getInt("version") != 1 || !key.equals(string(metadata, "key"))
                    || metadata.getLong("size") != size || size > LocalStorePolicy.MAX_OBJECT_BYTES) throw new IOException("Stored object metadata does not match its contents.");
            String expected = string(metadata, "etag");
            if (!expected.matches("[a-f0-9]{64}")) throw new IOException("Stored object checksum is invalid.");
            String mime = string(metadata.getJSONObject("httpMetadata"), "contentType");
            if (!mime.equals(ExportPayload.safeMime(mime))) throw new IOException("Stored object MIME is invalid.");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            ByteArrayOutputStream body = includeBytes ? new ByteArrayOutputStream((int) size) : null;
            byte[] buffer = new byte[8192];
            long consumed = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                consumed += count;
                if (consumed > size) throw new IOException("Stored object grew while reading.");
                digest.update(buffer, 0, count);
                if (body != null) body.write(buffer, 0, count);
            }
            if (consumed != size || !expected.equals(hex(digest.digest()))) throw new IOException("Stored object integrity check failed.");
            return new StoredObject(metadata, body == null ? null : body.toByteArray());
        } finally { closeDescriptor(fd); }
    }

    private Object objectResult(StoredObject stored, boolean includeBytes) throws JSONException {
        if (stored == null) return JSONObject.NULL;
        JSONObject meta = stored.metadata;
        JSONObject result = new JSONObject().put("key", meta.getString("key"))
                .put("mime", meta.getJSONObject("httpMetadata").getString("contentType"))
                .put("size", meta.getLong("size")).put("sha256", meta.getString("etag"))
                .put("uploaded", meta.getString("uploaded"));
        if (includeBytes) {
            try { result.put("data", Base64.getEncoder().encodeToString(stored.bytes)); }
            finally { Arrays.fill(stored.bytes, (byte) 0); }
        }
        return result;
    }

    private Object putObject(JSONObject request) throws Exception {
        String key = string(request, "key"), encoded = string(request, "data");
        File destination = objectFile(key);
        if (encoded.length() > ((LocalStorePolicy.MAX_OBJECT_BYTES + 2L) / 3L) * 4L) throw new IllegalArgumentException("Object exceeds 25 MiB.");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Object base64 is invalid."); }
        if (bytes.length > LocalStorePolicy.MAX_OBJECT_BYTES) throw new IllegalArgumentException("Object exceeds 25 MiB.");
        try {
            String mime = request.has("mime") ? string(request, "mime") : "application/octet-stream";
            if (!mime.equals(ExportPayload.safeMime(mime))) throw new IllegalArgumentException("Object MIME is invalid.");
            JSONObject metadata = new JSONObject().put("version", 1).put("key", key).put("size", bytes.length)
                    .put("etag", hex(MessageDigest.getInstance("SHA-256").digest(bytes)))
                    .put("uploaded", Instant.now().toString())
                    .put("httpMetadata", new JSONObject().put("contentType", mime))
                    .put("customMetadata", new JSONObject());
            byte[] header = metadata.toString().getBytes(StandardCharsets.UTF_8);
            if (header.length > MAX_HEADER_BYTES) throw new IllegalArgumentException("Object metadata is too large.");
            File temporary = new File(objectDirectory, ".tmp-" + UUID.randomUUID());
            boolean created = false;
            try {
                FileDescriptor fd = Os.open(temporary.getPath(), OsConstants.O_WRONLY | OsConstants.O_CREAT
                        | OsConstants.O_EXCL | OsConstants.O_NOFOLLOW | OsConstants.O_CLOEXEC, 0600);
                created = true;
                try (DataOutputStream output = new DataOutputStream(new FileOutputStream(fd))) {
                    output.writeInt(header.length); output.write(header); output.write(bytes); output.flush(); Os.fsync(fd);
                } finally { closeDescriptor(fd); }
                rejectSymlink(destination);
                Os.rename(temporary.getPath(), destination.getPath());
                created = false;
                syncDirectory(objectDirectory);
            } finally {
                if (created) {
                    try { Os.remove(temporary.getPath()); }
                    catch (ErrnoException cleanup) { if (cleanup.errno != OsConstants.ENOENT) throw cleanup; }
                }
            }
            return objectResult(new StoredObject(metadata, null), false);
        } finally { Arrays.fill(bytes, (byte) 0); }
    }

    private void deleteObject(String key) throws Exception {
        File file = objectFile(key);
        rejectSymlink(file);
        try { Os.remove(file.getPath()); }
        catch (ErrnoException error) { if (error.errno != OsConstants.ENOENT) throw error; }
        syncDirectory(objectDirectory);
    }

    /** Native resource requests bypass the JS fetch adapter, so authorize binary routes here. */
    public synchronized WebResourceResponse interceptLocalApi(Uri uri) {
        try {
            ensureOpen();
            if (uri == null || !"https".equals(uri.getScheme()) || !"local.qingdan.invalid".equals(uri.getHost())
                    || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null) return deny(403);
            String path = uri.getEncodedPath();
            boolean background = "/api/countdown-background".equals(path);
            if (!background && !"/api/attachments".equals(path)) return deny(404);
            List<String> ids = uri.getQueryParameters("id");
            if (ids.size() != 1 || ids.get(0).isEmpty() || ids.get(0).length() > 500) return deny(404);
            String key = null, mime = null, name = null;
            long declaredSize = -1;
            database.beginTransactionNonExclusive();
            try {
                String sql = "SELECT a.key,a.mime,a.size,a.name FROM attachments a JOIN records r ON r.id=a.record_id WHERE a.id=? AND a.owner_id=? AND r.owner_id=? AND r.deleted=0 AND r.kind=?";
                try (RowCursor attachment = database.rawQuery(sql, new String[]{ids.get(0), principalId, principalId, background ? "countdown" : "task"})) {
                    if (attachment.moveToFirst()) {
                        key = attachment.getString(0); mime = attachment.getString(1);
                        declaredSize = attachment.getLong(2); name = attachment.getString(3);
                    }
                }
                database.setTransactionSuccessful();
            } finally { database.endTransaction(); }
            if (key == null) return deny(404);
            if (background && (!ids.get(0).startsWith("bg:") || !Arrays.asList("image/jpeg", "image/png", "image/webp").contains(mime))) return deny(404);
            StoredObject object = readObject(key, true);
            if (object == null || object.bytes.length != declaredSize) return deny(404);
            if (background && !mime.equals(object.metadata.getJSONObject("httpMetadata").getString("contentType"))) return deny(404);
            Map<String, String> headers = responseHeaders();
            headers.put("Content-Disposition", background ? "inline" : "attachment; filename*=UTF-8''" + Uri.encode(ExportPayload.safeFilename(name)));
            return new WebResourceResponse(background ? mime : "application/octet-stream", null, 200, "OK", headers, new ByteArrayInputStream(object.bytes));
        } catch (Exception error) { return deny(503); }
    }

    private static WebResourceResponse deny(int status) {
        String reason = status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Service Unavailable";
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, responseHeaders(),
                new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }
    private static Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "private, no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'; sandbox");
        return headers;
    }

    private static void secureDirectory(File directory) throws Exception {
        if (directory == null) throw new IOException("Storage directory is missing.");
        rejectSymlink(directory);
        if (!directory.exists() && !directory.mkdir()) throw new IOException("Cannot create private storage directory.");
        if (!directory.isDirectory()) throw new IOException("Storage path is not a directory.");
        Os.chmod(directory.getPath(), 0700);
    }
    private static void rejectSymlink(File file) throws ErrnoException, IOException {
        try { if (OsConstants.S_ISLNK(Os.lstat(file.getPath()).st_mode)) throw new IOException("Storage path cannot be a symbolic link."); }
        catch (ErrnoException error) { if (error.errno != OsConstants.ENOENT) throw error; }
    }
    private static void closeDescriptor(FileDescriptor fd) throws ErrnoException {
        // Android FileInput/OutputStream(FileDescriptor) borrows the descriptor; it does not own it.
        // valid() also avoids a double close on JVMs that do transfer ownership to the stream.
        if (fd.valid()) Os.close(fd);
    }
    private static void syncDirectory(File directory) throws ErrnoException, IOException {
        FileDescriptor fd = Os.open(directory.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_CLOEXEC, 0);
        try {
            if (!OsConstants.S_ISDIR(Os.fstat(fd).st_mode)) throw new IOException("Object storage is not a directory.");
            Os.fsync(fd);
        } finally { Os.close(fd); }
    }
    private static byte[] readBounded(InputStream input, int maximum) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > maximum) throw new IOException("Bundled file is too large.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
    private static String string(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof String)) throw new IllegalArgumentException("Expected text for " + key + ".");
        return (String) value;
    }
    private static String hex(byte[] bytes) {
        char[] alphabet = "0123456789abcdef".toCharArray(), output = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) { output[i * 2] = alphabet[(bytes[i] & 255) >>> 4]; output[i * 2 + 1] = alphabet[bytes[i] & 15]; }
        return new String(output);
    }
    private static String message(Throwable error) {
        // Driver/OS diagnostics are not interface text and may contain paths or SQL values.
        return NativeErrors.storageMessage(error.getMessage());
    }
    private void ensureOpen() { if (closed) throw new IllegalStateException("Local store is closed."); }
    @Override public synchronized void close() { if (!closed) { database.close(); closed = true; } }
}
