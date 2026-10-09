package cn.qingdan.android;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/** Strict bounded parser for the one-way, foreground navigation export channel. */
public final class ExportPayload {
    public static final int MAX_BYTES = 25 * 1024 * 1024;
    public static final int MAX_URL_BYTES = 1024 * 1024;
    public static final int MAX_URL_CHARS = 1500 * 1024;
    public final String filename;
    public final String mime;
    public final byte[] bytes;

    private ExportPayload(String filename, String mime, byte[] bytes) {
        this.filename = filename; this.mime = mime; this.bytes = bytes;
    }

    public static ExportPayload parse(String value) {
        Map<String, String> query = query(value, "export", MAX_URL_CHARS);
        if (query.size() != 3 || !query.containsKey("filename") || !query.containsKey("mime") || !query.containsKey("data")) {
            throw new IllegalArgumentException("导出参数无效");
        }
        String encoded = query.get("data");
        if (encoded.length() > ((MAX_URL_BYTES + 2L) / 3L) * 4L) throw new IllegalArgumentException("此导出路径只支持 1 MB，请使用分块导出");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("导出内容编码无效"); }
        if (bytes.length > MAX_URL_BYTES) throw new IllegalArgumentException("此导出路径只支持 1 MB，请使用分块导出");
        return new ExportPayload(safeFilename(query.get("filename")), safeMime(query.get("mime")), bytes);
    }

    static Map<String, String> query(String value, String command, int maxChars) {
        if (value == null || value.length() > maxChars) throw new IllegalArgumentException("请求太大");
        URI uri = OriginPolicy.uri(value);
        if (uri == null || !"qingdanapp".equals(uri.getScheme()) || !command.equals(uri.getHost())
                || uri.getPort() != -1 || uri.getRawUserInfo() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))) {
            throw new IllegalArgumentException("请求地址无效");
        }
        Map<String, String> result = new HashMap<>();
        String rawQuery = uri.getRawQuery();
        if (rawQuery == null || rawQuery.isEmpty()) return result;
        for (String pair : rawQuery.split("&", -1)) {
            int split = pair.indexOf('=');
            if (split <= 0) throw new IllegalArgumentException("请求参数无效");
            String key = decode(pair.substring(0, split));
            String data = decode(pair.substring(split + 1));
            if (result.put(key, data) != null) throw new IllegalArgumentException("请求参数重复");
        }
        return result;
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value, StandardCharsets.UTF_8.name()); }
        catch (Exception error) { throw new IllegalArgumentException("请求编码无效"); }
    }

    public static String safeFilename(String value) {
        if (value == null || value.trim().isEmpty()) return "qingdan-export.json";
        String result = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (result.startsWith(".")) result = result.substring(1);
        if (result.length() > 120) result = result.substring(0, 120);
        return result.isEmpty() ? "qingdan-export.json" : result;
    }

    public static String safeMime(String value) {
        if (value == null || value.length() > 120 || !value.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) {
            return "application/octet-stream";
        }
        return value;
    }
}
