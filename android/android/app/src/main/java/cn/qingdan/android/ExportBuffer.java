package cn.qingdan.android;

import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;

/** One bounded, write-only transfer; contains no file/database read capability. */
public final class ExportBuffer {
    public static final int CHUNK_BYTES = 32 * 1024;
    private String nonce;
    private String filename;
    private String mime;
    private byte[] data;
    private int written;
    private long deadline;

    public synchronized String begin(String filename, String mime, long size) {
        if (data != null && System.nanoTime() <= deadline) return "";
        clear();
        if (size < 0 || size > ExportPayload.MAX_BYTES) return "";
        this.filename = ExportPayload.safeFilename(filename);
        this.mime = ExportPayload.safeMime(mime);
        data = new byte[(int) size];
        nonce = UUID.randomUUID().toString();
        deadline = System.nanoTime() + 300_000_000_000L;
        return nonce;
    }

    public synchronized boolean append(String token, String base64) {
        if (!matches(token)) return false;
        if (base64 == null || base64.length() > ((CHUNK_BYTES + 2) / 3) * 4) { clear(); return false; }
        byte[] chunk;
        try { chunk = Base64.getDecoder().decode(base64); }
        catch (IllegalArgumentException error) { clear(); return false; }
        if (chunk.length > CHUNK_BYTES || chunk.length > data.length - written) {
            Arrays.fill(chunk, (byte) 0); clear(); return false;
        }
        System.arraycopy(chunk, 0, data, written, chunk.length);
        written += chunk.length; Arrays.fill(chunk, (byte) 0); return true;
    }

    public synchronized Completed complete(String token) {
        if (!matches(token)) return null;
        if (written != data.length) { clear(); return null; }
        Completed result = new Completed(filename, mime, data);
        // Ownership moves to the save operation; do not make a second 25 MB copy.
        data = null; nonce = null; filename = null; mime = null; written = 0; deadline = 0;
        return result;
    }

    public synchronized boolean cancel(String token) {
        if (nonce == null || !nonce.equals(token)) return false;
        clear(); return true;
    }

    public synchronized void clear() {
        if (data != null) Arrays.fill(data, (byte) 0);
        data = null; nonce = null; filename = null; mime = null; written = 0; deadline = 0;
    }

    private boolean matches(String token) {
        if (data == null || nonce == null || !nonce.equals(token)) return false;
        if (System.nanoTime() > deadline) { clear(); return false; }
        return true;
    }

    public static final class Completed {
        public final String filename;
        public final String mime;
        public final byte[] bytes;
        Completed(String filename, String mime, byte[] bytes) { this.filename = filename; this.mime = mime; this.bytes = bytes; }
    }
}
