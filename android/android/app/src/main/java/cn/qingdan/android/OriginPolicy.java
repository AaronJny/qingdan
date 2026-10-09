package cn.qingdan.android;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Pure-Java, deny-by-default URL policy. No credentials or server paths are stored. */
public final class OriginPolicy {
    public static final String LOCAL_HOST = "local.qingdan.invalid";
    public enum Route { ROOT, ASSET, API, BLOCKED }
    private final String host;
    private final int port;
    private final String origin;

    private OriginPolicy(String host, int port) {
        this.host = host.toLowerCase(Locale.ROOT);
        this.port = port;
        this.origin = "https://" + this.host + (port == 443 ? "" : ":" + port);
    }

    public static OriginPolicy parseEndpoint(String input) {
        if (input == null || input.trim().length() > 512) throw invalid();
        URI uri = uri(input.trim());
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))) {
            throw invalid();
        }
        if (LOCAL_HOST.equalsIgnoreCase(uri.getHost())) throw invalid();
        int port = uri.getPort() == -1 ? 443 : uri.getPort();
        if (port < 1 || port > 65535 || uri.getRawAuthority().endsWith(":")) throw invalid();
        return new OriginPolicy(uri.getHost(), port);
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("请输入完整 HTTPS 源地址，例如 https://qingdan.example.com；不要带用户名、密码、路径或参数。证书必须有效。");
    }

    public static OriginPolicy local() { return new OriginPolicy(LOCAL_HOST, 443); }
    public boolean isLocal() { return LOCAL_HOST.equals(host); }
    public String origin() { return origin; }
    public String rootUrl() { return origin + "/"; }

    public boolean isSameOrigin(String value) {
        URI uri = uri(value);
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getRawUserInfo() != null || uri.getRawAuthority().endsWith(":")) return false;
        return host.equalsIgnoreCase(uri.getHost()) && port == (uri.getPort() == -1 ? 443 : uri.getPort());
    }

    public boolean isRootDocument(String value) {
        URI uri = uri(value);
        return isSameOrigin(value) && uri != null && "/".equals(uri.getRawPath());
    }

    public Route route(String value) {
        URI uri = uri(value);
        if (!isSameOrigin(value) || uri == null) return Route.BLOCKED;
        String raw = uri.getRawPath();
        if (raw == null || raw.isEmpty()) raw = "/";
        String decoded = uri.getPath();
        if (decoded == null || decoded.indexOf('\\') >= 0 || decoded.indexOf('\0') >= 0
                || raw.toLowerCase(Locale.ROOT).contains("%2f") || raw.toLowerCase(Locale.ROOT).contains("%5c")) {
            return Route.BLOCKED;
        }
        for (String part : decoded.split("/", -1)) {
            if (".".equals(part) || "..".equals(part)) return Route.BLOCKED;
        }
        if ("/".equals(raw)) return Route.ROOT;
        if ("/api".equals(raw) || raw.startsWith("/api/")) return Route.API;
        if ((raw.startsWith("/assets/") && raw.indexOf('%') < 0 && raw.length() > 8)
                || "/favicon.svg".equals(raw) || "/favicon.ico".equals(raw) || "/favicon.png".equals(raw)) return Route.ASSET;
        return Route.BLOCKED;
    }

    /** Keep remote API responses from becoming HTML, scripts, subframes, or workers. */
    public String contentSecurityPolicy() {
        return "default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; "
                + "worker-src 'none'; form-action 'none'; "
                + "script-src " + origin + "/assets/; "
                + "style-src " + origin + "/assets/ 'unsafe-inline'; "
                + "font-src " + origin + "/assets/ data:; "
                + "img-src " + origin + "/assets/ " + origin + "/api/ " + origin + "/favicon.svg data: blob:; "
                + "media-src " + origin + "/api/ blob:; "
                + (isLocal() ? "connect-src 'none'; " : "connect-src " + origin + "/api/ " + origin + "/api; ")
                + "manifest-src 'none'; upgrade-insecure-requests";
    }

    public static URI uri(String value) {
        try { return value == null ? null : new URI(value); }
        catch (URISyntaxException | IllegalArgumentException ignored) { return null; }
    }
}
