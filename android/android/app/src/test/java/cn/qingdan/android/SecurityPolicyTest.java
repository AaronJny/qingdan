package cn.qingdan.android;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Dependency-free security regression suite: run with javac/java, no Android SDK. */
public final class SecurityPolicyTest {
    private static int checks;
    private static void check(boolean value, String description) {
        checks++; if (!value) throw new AssertionError(description);
    }
    private static void invalidEndpoint(String input) {
        try { OriginPolicy.parseEndpoint(input); throw new AssertionError("Endpoint accepted: " + input); }
        catch (IllegalArgumentException expected) { checks++; }
    }
    private static void invalidExport(String input) {
        try { ExportPayload.parse(input); throw new AssertionError("Export accepted: " + input); }
        catch (IllegalArgumentException expected) { checks++; }
    }
    public static void main(String[] args) {
        OriginPolicy origin = OriginPolicy.parseEndpoint("  https://QINGDAN.example:443/  ");
        check("https://qingdan.example".equals(origin.origin()), "canonical HTTPS origin");
        check("https://qingdan.example/".equals(origin.rootUrl()), "local root has a real origin");
        for (String endpoint : new String[]{"http://qingdan.example", "file:///x", "javascript:alert(1)", "https://user:pass@qingdan.example", "https://qingdan.example/api", "https://qingdan.example/?x=1", "https://qingdan.example/#x", "https://qingdan.example:0", "https://qingdan.example:65536", "https://qingdan.example:", "https://qingdan.example\\@evil.example", "https://qingdan.example%2fevil.example", "https://local.qingdan.invalid", "https://LOCAL.QINGDAN.INVALID:443/", "//qingdan.example", "https://", ""}) invalidEndpoint(endpoint);
        check(origin.isSameOrigin("https://QINGDAN.example:443/api/data"), "case/default port normalization");
        check(!origin.isSameOrigin("https://qingdan.example:444/api/data"), "different ports isolated");
        check(!origin.isSameOrigin("https://qingdan.example.evil/api/data"), "host suffix denied");
        check(!origin.isSameOrigin("https://user@qingdan.example/api/data"), "userinfo denied");
        check(!origin.isSameOrigin("http://qingdan.example/api/data"), "cleartext denied");
        check(origin.route("https://qingdan.example/") == OriginPolicy.Route.ROOT, "APK root route");
        check(origin.route("https://qingdan.example/?view=tasks#task") == OriginPolicy.Route.ROOT, "root query/hash stays APK owned");
        check(origin.route("https://qingdan.example/assets/app-Ab12.js") == OriginPolicy.Route.ASSET, "APK immutable asset");
        check(origin.route("https://qingdan.example/favicon.svg") == OriginPolicy.Route.ASSET, "favicon asset");
        check(origin.route("https://qingdan.example/api") == OriginPolicy.Route.API, "API exact path");
        check(origin.route("https://qingdan.example/api/data?cursor=foo") == OriginPolicy.Route.API, "API subpath/query");
        for (String path : new String[]{"/api-evil", "/login", "/index.html", "/assets/../index.html", "/assets/%2e%2e/index.html", "/assets/%2fweb.js", "/api/../login", "/api/%2e%2e/login", "/api/%5cevil", "/api/%00foo"}) {
            check(origin.route("https://qingdan.example" + path) == OriginPolicy.Route.BLOCKED, "ambiguous/non-whitelisted path blocked: " + path);
        }
        check(origin.isRootDocument("https://qingdan.example/#modal"), "hash root trusted");
        check(!origin.isRootDocument("https://qingdan.example/api/data"), "API document never trusted");
        check(!origin.isRootDocument("https://evil.example/"), "other root untrusted");
        OriginPolicy ipv6 = OriginPolicy.parseEndpoint("https://[::1]:8443");
        check("https://[::1]:8443".equals(ipv6.origin()), "HTTPS IPv6 explicit origin");
        check(ipv6.isSameOrigin("https://[::1]:8443/api/data"), "IPv6 same origin");
        OriginPolicy local = OriginPolicy.local();
        check(local.isLocal(), "reserved local host is explicit mode");
        check(local.contentSecurityPolicy().contains("connect-src 'none'"), "local mode cannot connect");
        check(origin.contentSecurityPolicy().contains("frame-src 'none'"), "subframes blocked");
        check(origin.contentSecurityPolicy().contains("worker-src 'none'"), "service workers blocked");
        check(!origin.contentSecurityPolicy().contains("script-src 'self'"), "API cannot be remote executable script");
        check(!origin.contentSecurityPolicy().contains("unsafe-eval"), "eval blocked");
        ExportPayload export = ExportPayload.parse("qingdanapp://export?filename=backup.json&mime=application%2Fjson&data=eyJhIjoxfQ%3D%3D");
        check("backup.json".equals(export.filename), "filename preserved");
        check("application/json".equals(export.mime), "MIME preserved");
        check(Arrays.equals("{\"a\":1}".getBytes(StandardCharsets.UTF_8), export.bytes), "base64 decoded");
        for (String invalid : new String[]{"https://export?filename=x&mime=x&data=YQ==", "qingdanapp://other?filename=x&mime=x&data=YQ==", "qingdanapp://export:1?filename=x&mime=x&data=YQ==", "qingdanapp://user@export?filename=x&mime=x&data=YQ==", "qingdanapp://export/path?filename=x&mime=x&data=YQ==", "qingdanapp://export?filename=x&mime=x&data=YQ==#a", "qingdanapp://export?filename=x&mime=x&data=@@", "qingdanapp://export?filename=x&mime=x&data=YQ==&data=Yg==", "qingdanapp://export?filename=x&data=YQ==", "qingdanapp://export?filename=x&mime=x&data=YQ==&other=x", "qingdanapp://export?filename=%GG&mime=x&data=YQ=="}) invalidExport(invalid);
        check("_etc_passwd".equals(ExportPayload.safeFilename("../etc/passwd")), "filename traversal removed");
        check("application/octet-stream".equals(ExportPayload.safeMime("text/html\r\nX-Header: bad")), "MIME header injection blocked");
        check(ExportPayload.safeFilename("x".repeat(500)).length() == 120, "filename bounded");
        invalidExport("qingdanapp://export?filename=x&mime=x&data=" + "A".repeat(((ExportPayload.MAX_URL_BYTES + 2) / 3) * 4 + 4));
        ExportBuffer buffer = new ExportBuffer();
        check(buffer.begin("x", "text/plain", -1).isEmpty(), "negative export rejected");
        check(buffer.begin("x", "text/plain", ExportPayload.MAX_BYTES + 1L).isEmpty(), "oversize chunk transfer rejected");
        String nonce = buffer.begin("../backup.json", "application/json", 3);
        check(!nonce.isEmpty(), "transfer gets random nonce");
        check(buffer.begin("other", "text/plain", 1).isEmpty(), "parallel transfer rejected");
        check(!buffer.append("wrong", "YWJj"), "wrong nonce rejected");
        check(buffer.append(nonce, "YQ=="), "first chunk accepted");
        check(buffer.append(nonce, "YmM="), "second chunk accepted");
        ExportBuffer.Completed completed = buffer.complete(nonce);
        check(completed != null && Arrays.equals(completed.bytes, new byte[]{97,98,99}), "exact transfer completed");
        check(buffer.complete(nonce) == null, "nonce cannot replay");
        nonce = buffer.begin("x", "text/plain", 1);
        check(!buffer.append(nonce, "YWI="), "overflow clears transfer");
        check(buffer.complete(nonce) == null, "failed transfer cannot complete");
        nonce = buffer.begin("x", "text/plain", 2);
        check(buffer.append(nonce, "YQ==") && buffer.complete(nonce) == null, "truncated transfer rejected");
        nonce = buffer.begin("x", "text/plain", ExportBuffer.CHUNK_BYTES + 1L);
        check(!buffer.append(nonce, java.util.Base64.getEncoder().encodeToString(new byte[ExportBuffer.CHUNK_BYTES + 1])), "oversize chunk rejected");
        nonce = buffer.begin("x", "text/plain", 1);
        check(buffer.cancel(nonce) && !buffer.append(nonce, "YQ=="), "cancel invalidates nonce");
        nonce = buffer.begin("x", "text/plain", 1); buffer.clear();
        check(!buffer.append(nonce, "YQ=="), "mode switch clears transport");
        nonce = buffer.begin("empty", "text/plain", 0);
        check(buffer.complete(nonce).bytes.length == 0, "empty export supported");
        System.out.println("Security policy: " + checks + " assertions passed");
    }
}
