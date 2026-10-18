package cn.qingdan.android;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
/** Exact known native error messages only. Never applied to user records or SQL results. */
final class NativeErrors {
    private static final Map<String, String> KEYS;
    static {
        Map<String, String> keys = new HashMap<>();
        keys.put("Cannot inspect local object storage.", "storage.error.cannot.inspect.local.object.storage");
        keys.put("Local database requires WAL.", "storage.error.local.database.requires.wal");
        keys.put("Local database requires synchronous=FULL.", "storage.error.local.database.requires.synchronous.full");
        keys.put("Local request is too large.", "storage.error.local.request.is.too.large");
        keys.put("Unsupported local action.", "storage.error.unsupported.local.action");
        keys.put("Local batch is too large.", "storage.error.local.batch.is.too.large");
        keys.put("SQL parameter count does not match values.", "storage.error.sql.parameter.count.does.not.match.values");
        keys.put("Unexpected SQL result rows.", "storage.error.unexpected.sql.result.rows");
        keys.put("Cannot read SQL metadata.", "storage.error.cannot.read.sql.metadata");
        keys.put("SQL results exceed the local response budget.", "storage.error.sql.results.exceed.the.local.response.budget");
        keys.put("SQL result contains too many rows.", "storage.error.sql.result.contains.too.many.rows");
        keys.put("SQL result exceeds the local response budget.", "storage.error.sql.result.exceeds.the.local.response.budget");
        keys.put("SQL values must be strings, finite numbers or null.", "storage.error.sql.values.must.be.strings.finite.numbers.or");
        keys.put("Invalid SQL value.", "storage.error.invalid.sql.value");
        keys.put("JSON functions returned invalid results.", "storage.error.json.functions.returned.invalid.results");
        keys.put("The bundled SQLite runtime lacks required JSON functions. Local data has not been adopted.", "storage.error.the.bundled.sqlite.runtime.lacks.required.json.functions");
        keys.put("Stored files have no verified local mode marker. Restore or import explicitly.", "storage.error.stored.files.have.no.verified.local.mode.marker");
        keys.put("Existing data has no verified mode marker. Automatic adoption is blocked; export/import into a new local store.", "storage.error.existing.data.has.no.verified.mode.marker.automatic");
        keys.put("This database belongs to account mode and cannot be opened as local mode.", "storage.error.this.database.belongs.to.account.mode.and.cannot");
        keys.put("Local identity metadata is invalid. Restore a verified backup.", "storage.error.local.identity.metadata.is.invalid.restore.a.verified");
        keys.put("Account users cannot be adopted by a local store.", "storage.error.account.users.cannot.be.adopted.by.a.local");
        keys.put("Account sessions cannot be adopted by a local store.", "storage.error.account.sessions.cannot.be.adopted.by.a.local");
        keys.put("Local identity must not contain a password-enabled account.", "storage.error.local.identity.must.not.contain.a.password.enabled");
        keys.put("No bundled migrations found.", "storage.error.no.bundled.migrations.found");
        keys.put("SQL scalar result is missing.", "storage.error.sql.scalar.result.is.missing");
        keys.put("Invalid internal SQL binding.", "storage.error.invalid.internal.sql.binding");
        keys.put("Nested local transactions are not supported.", "storage.error.nested.local.transactions.are.not.supported");
        keys.put("No local transaction.", "storage.error.no.local.transaction");
        keys.put("Cannot rewind a local statement.", "storage.error.cannot.rewind.a.local.statement");
        keys.put("Stored object size or type is invalid.", "storage.error.stored.object.size.or.type.is.invalid");
        keys.put("Stored object metadata is invalid.", "storage.error.stored.object.metadata.is.invalid");
        keys.put("Stored object metadata does not match its contents.", "storage.error.stored.object.metadata.does.not.match.its.contents");
        keys.put("Stored object checksum is invalid.", "storage.error.stored.object.checksum.is.invalid");
        keys.put("Stored object MIME is invalid.", "storage.error.stored.object.mime.is.invalid");
        keys.put("Stored object grew while reading.", "storage.error.stored.object.grew.while.reading");
        keys.put("Stored object integrity check failed.", "storage.error.stored.object.integrity.check.failed");
        keys.put("Object exceeds 25 MiB.", "storage.error.object.exceeds.25.mib");
        keys.put("Object base64 is invalid.", "storage.error.object.base64.is.invalid");
        keys.put("Object MIME is invalid.", "storage.error.object.mime.is.invalid");
        keys.put("Object metadata is too large.", "storage.error.object.metadata.is.too.large");
        keys.put("Storage directory is missing.", "storage.error.storage.directory.is.missing");
        keys.put("Cannot create private storage directory.", "storage.error.cannot.create.private.storage.directory");
        keys.put("Storage path is not a directory.", "storage.error.storage.path.is.not.a.directory");
        keys.put("Storage path cannot be a symbolic link.", "storage.error.storage.path.cannot.be.a.symbolic.link");
        keys.put("Object storage is not a directory.", "storage.error.object.storage.is.not.a.directory");
        keys.put("Bundled file is too large.", "storage.error.bundled.file.is.too.large");
        keys.put("Local store is closed.", "storage.error.local.store.is.closed");
        keys.put("SQL is too large.", "storage.error.sql.is.too.large");
        keys.put("Exactly one SQL statement is required.", "storage.error.exactly.one.sql.statement.is.required");
        keys.put("SQL is empty.", "storage.error.sql.is.empty");
        keys.put("SQL cannot access protected storage or external files.", "storage.error.sql.cannot.access.protected.storage.or.external.files");
        keys.put("Only SELECT, INSERT, UPDATE and DELETE are supported.", "storage.error.only.select.insert.update.and.delete.are.supported");
        keys.put("Invalid SQL.", "storage.error.invalid.sql");
        keys.put("Unbalanced SQL.", "storage.error.unbalanced.sql");
        keys.put("Use anonymous SQL parameters.", "storage.error.use.anonymous.sql.parameters");
        keys.put("Invalid SQL control character.", "storage.error.invalid.sql.control.character");
        keys.put("Unterminated SQL quote.", "storage.error.unterminated.sql.quote");
        keys.put("Unterminated SQL comment.", "storage.error.unterminated.sql.comment");
        KEYS = Collections.unmodifiableMap(keys);
    }
    static String storageMessage(String message) {
        // The bundled D1-compatible backend uses this stable machine marker for
        // conflict handling and idempotent replay, then returns a localized UI error.
        if (message != null && message.contains("UNIQUE constraint failed")) return "UNIQUE constraint failed";
        String key = KEYS.get(message);
        return NativeLanguage.text(key == null ? "storage.operation.failed" : key);
    }
}
