package cn.qingdan.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.FilterInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** APK-owned UI at an exact HTTPS origin. Remote HTML never receives app privileges. */
public final class MainActivity extends Activity {
    private static final int PICK_UPLOAD = 10;
    private static final int SAVE_DOWNLOAD = 11;
    private static final int NOTIFICATION_PERMISSION = 12;
    private static final String PREFS = "qingdan-host";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private LinearLayout shell;
    private FrameLayout webContainer;
    private TextView modeLabel;
    private Button settingsButton;
    private WebView browser;
    private OriginPolicy policy;
    private LocalStore localStore;
    private SharedPreferences preferences;
    private ValueCallback<Uri[]> uploadCallback;
    private PendingSave pendingSave;
    private volatile boolean resumed;
    private volatile boolean nativeDocumentReady;
    private ExportBridge exportBridge;
    private boolean backPending;
    private boolean notificationRequestPending;
    private boolean keyboardVisible;
    private int largestVisibleFrameHeight;
    private int visibleFrameWidth;
    private volatile int generation;
    private OnBackInvokedCallback backCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        android.content.Context appContext = getApplicationContext();
        NativeLanguage.setTranslator((key, locale) -> {
            android.content.res.Configuration configuration = new android.content.res.Configuration(appContext.getResources().getConfiguration());
            configuration.setLocale(Locale.forLanguageTag(locale));
            android.content.Context localized = appContext.createConfigurationContext(configuration);
            int id = appContext.getResources().getIdentifier(key.replace('.', '_'), "string", appContext.getPackageName());
            return id == 0 ? key : localized.getString(id);
        });
        NativeLanguage.setPreference(NativeLanguage.normalizePreference(preferences.getString("language", "system")));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        createShell();
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        createNotificationChannel();
        boolean local = !"account".equals(preferences.getString("mode", "local"));
        if (local) openOrigin(OriginPolicy.local());
        else {
            try { openOrigin(OriginPolicy.parseEndpoint(preferences.getString("endpoint", ""))); }
            catch (IllegalArgumentException error) { showModeDialog(true); }
        }
    }

    private void createShell() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(247, 248, 250));
        shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(14), 0, dp(6), 0);
        modeLabel = new TextView(this);
        modeLabel.setTextSize(14);
        modeLabel.setTextColor(Color.rgb(55, 65, 81));
        modeLabel.setText(NativeLanguage.text("app.name"));
        header.addView(modeLabel, new LinearLayout.LayoutParams(0, -1, 1));
        modeLabel.setGravity(Gravity.CENTER_VERTICAL);
        Button settings = new Button(this); settingsButton = settings;
        settings.setText(NativeLanguage.text("settings.mode"));
        settings.setTextSize(12);
        settings.setAllCaps(false);
        settings.setOnClickListener(v -> showModeDialog(false));
        header.addView(settings, new LinearLayout.LayoutParams(-2, -1));
        shell.addView(header, new LinearLayout.LayoutParams(-1, dp(44)));
        webContainer = new FrameLayout(this);
        shell.addView(webContainer, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(shell, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                // Padding changes the measured native WebView viewport, not merely CSS margins.
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                updateKeyboardVisibility(insets.isVisible(WindowInsets.Type.ime()));
                return insets;
            });
            root.requestApplyInsets();
        } else {
            root.setFitsSystemWindows(true);
            root.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
                // adjustResize is primary on API 26-29. This catches OEM overlay keyboards.
                Rect visible = new Rect();
                root.getWindowVisibleDisplayFrame(visible);
                int[] pos = new int[2]; root.getLocationOnScreen(pos);
                int overflow = Math.max(0, pos[1] + root.getHeight() - visible.bottom);
                int padding = overflow > dp(100) ? overflow : 0;
                if (root.getPaddingBottom() != padding) root.setPadding(0, 0, 0, padding);
                // On legacy/OEM resize paths use a width-scoped visible-frame baseline.
                // If no reliable baseline exists, false lets the system consume IME Back.
                if (visibleFrameWidth != visible.width()) {
                    visibleFrameWidth = visible.width(); largestVisibleFrameHeight = visible.height();
                }
                largestVisibleFrameHeight = Math.max(largestVisibleFrameHeight, visible.height());
                updateKeyboardVisibility(padding > 0 || largestVisibleFrameHeight - visible.height() > dp(100));
            });
        }
    }

    private void showModeDialog(boolean required) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(4), dp(20), dp(4));
        TextView languageLabel = new TextView(this); languageLabel.setText(NativeLanguage.text("language.label")); content.addView(languageLabel);
        android.widget.Spinner language = new android.widget.Spinner(this);
        String[] preferencesList = {"system", "zh-CN", "en"};
        language.setAdapter(new android.widget.ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{NativeLanguage.text("language.system"), "简体中文", "English"}));
        language.setSelection("zh-CN".equals(NativeLanguage.preference()) ? 1 : "en".equals(NativeLanguage.preference()) ? 2 : 0);
        content.addView(language);
        RadioGroup modes = new RadioGroup(this);
        RadioButton local = new RadioButton(this); local.setId(View.generateViewId()); local.setText(NativeLanguage.text("mode.local"));
        RadioButton account = new RadioButton(this); account.setId(View.generateViewId()); account.setText(NativeLanguage.text("mode.server"));
        modes.addView(local); modes.addView(account); content.addView(modes);
        EditText endpoint = new EditText(this);
        endpoint.setSingleLine(true);
        endpoint.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        endpoint.setHint("https://qingdan.example.com");
        endpoint.setText(preferences.getString("endpoint", ""));
        content.addView(endpoint);
        TextView detail = new TextView(this);
        detail.setText(NativeLanguage.text("mode.description"));
        detail.setTextSize(13); detail.setPadding(0, dp(8), 0, dp(12)); content.addView(detail);
        modes.check(policy != null && !policy.isLocal() ? account.getId() : local.getId());
        endpoint.setEnabled(modes.getCheckedRadioButtonId() == account.getId());
        modes.setOnCheckedChangeListener((group, checked) -> endpoint.setEnabled(checked == account.getId()));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(NativeLanguage.text("mode.title")).setView(content)
                .setPositiveButton(NativeLanguage.text("common.open"), null).setNegativeButton(NativeLanguage.text("common.cancel"), (d, w) -> { if (required && browser == null) moveTaskToBack(true); })
                .setNeutralButton(NativeLanguage.text("data.clear.action"), null).create();
        dialog.setCanceledOnTouchOutside(!required);
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                try {
                    OriginPolicy chosen = modes.getCheckedRadioButtonId() == local.getId()
                            ? OriginPolicy.local() : OriginPolicy.parseEndpoint(endpoint.getText().toString());
                    SharedPreferences.Editor editor = preferences.edit().putString("mode", chosen.isLocal() ? "local" : "account");
                    if (!chosen.isLocal()) editor.putString("endpoint", chosen.origin());
                    if (!setNativeLanguage(preferencesList[language.getSelectedItemPosition()])) return;
                    editor.apply(); dialog.dismiss(); openOrigin(chosen);
                } catch (IllegalArgumentException error) { endpoint.setError(error.getMessage()); }
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> confirmClearWebData());
        });
        dialog.show();
    }

    private void confirmClearWebData() {
        new AlertDialog.Builder(this).setTitle(NativeLanguage.text("data.clear.title"))
                .setMessage(NativeLanguage.text("data.clear.description"))
                .setNegativeButton(NativeLanguage.text("common.cancel"), null).setPositiveButton(NativeLanguage.text("common.clear"), (dialog, which) -> {
                    OriginPolicy reload = policy;
                    destroyBrowser();
                    WebStorage.getInstance().deleteAllData();
                    CookieManager.getInstance().removeAllCookies(done -> {
                        CookieManager.getInstance().flush();
                        if (reload != null) openOrigin(reload);
                    });
                }).show();
    }

    @SuppressWarnings("deprecation")
    private void openOrigin(OriginPolicy selected) {
        destroyBrowser();
        policy = selected;
        generation++;
        if (selected.isLocal()) {
            try { localStore = new LocalStore(this); }
            catch (Exception error) {
                showNativeError(NativeLanguage.text("storage.initialize.failed"), NativeErrors.storageMessage(error.getCause() == null ? error.getMessage() : error.getCause().getMessage()));
                return;
            }
        }
        modeLabel.setText(selected.isLocal() ? NativeLanguage.text("mode.local.title") : NativeLanguage.text("mode.server.title"));
        WebView view = new WebView(this);
        browser = view;
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " QingdanAndroid/0.1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        final LocalStore storeForView = localStore;
        // This identity/storage bridge is never installed in private-server mode.
        // All executable documents/assets in local mode are APK-owned and network is blocked.
        if (selected.isLocal()) view.addJavascriptInterface(storeForView, "QingdanLocal");
        exportBridge = new ExportBridge(selected, generation);
        view.addJavascriptInterface(exportBridge, "QingdanExport");
        view.setWebViewClient(new HostClient(selected, storeForView));
        view.setWebChromeClient(new HostChromeClient());
        view.setDownloadListener((url, agent, disposition, mime, size) -> {
            if (browser == view && !selected.isLocal() && selected.route(url) == OriginPolicy.Route.API && trustedRoot(view)) {
                offerSave(new PendingSave(selected, url, agent, android.webkit.URLUtil.guessFileName(url, disposition, mime), mime, null));
            } else toast(NativeLanguage.text("export.use.button"));
        });
        ServiceWorkerController workers = ServiceWorkerController.getInstance();
        workers.getServiceWorkerWebSettings().setAllowFileAccess(false);
        workers.getServiceWorkerWebSettings().setAllowContentAccess(false);
        workers.getServiceWorkerWebSettings().setBlockNetworkLoads(selected.isLocal());
        workers.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                // APK CSP forbids registration; guard any old origin-scoped worker too.
                return intercept(selected, storeForView, request);
            }
        });
        webContainer.addView(view, new FrameLayout.LayoutParams(-1, -1));
        view.loadUrl(selected.rootUrl());
    }

    private void showNativeError(String title, String detail) {
        LinearLayout notice = new LinearLayout(this); notice.setOrientation(LinearLayout.VERTICAL);
        notice.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView message = new TextView(this);
        message.setText(title + (detail == null ? "" : "\n\n" + detail));
        notice.addView(message, new LinearLayout.LayoutParams(-1, -2));
        Button retry = new Button(this); retry.setText(NativeLanguage.text("page.reopen"));
        retry.setOnClickListener(view -> { if (policy != null) openOrigin(policy); });
        notice.addView(retry, new LinearLayout.LayoutParams(-2, -2));
        webContainer.addView(notice, new FrameLayout.LayoutParams(-1, -1));
    }

    private void destroyBrowser() {
        generation++;
        nativeDocumentReady = false;
        if (exportBridge != null) { exportBridge.buffer.clear(); exportBridge = null; }
        if (uploadCallback != null) { uploadCallback.onReceiveValue(null); uploadCallback = null; }
        if (pendingSave != null) { pendingSave.erase(); pendingSave = null; }
        if (browser != null) {
            browser.removeJavascriptInterface("QingdanLocal");
            browser.removeJavascriptInterface("QingdanExport");
            browser.stopLoading(); browser.setWebChromeClient(null); browser.setWebViewClient(new WebViewClient());
            webContainer.removeView(browser); browser.destroy(); browser = null;
        }
        if (localStore != null) { localStore.close(); localStore = null; }
        webContainer.removeAllViews();
        backPending = false;
    }

    private boolean trustedRoot(WebView view) {
        return view != null && view == browser && policy != null && policy.isRootDocument(view.getUrl());
    }

    /** Write-only, APK-document-only transport. No identity, SQL, file reads or network. */
    public final class ExportBridge {
        final ExportBuffer buffer = new ExportBuffer();
        final OriginPolicy origin;
        final int createdGeneration;
        ExportBridge(OriginPolicy origin, int generation) { this.origin = origin; createdGeneration = generation; }
        private boolean active() { return generation == createdGeneration && nativeDocumentReady && resumed; }
        @JavascriptInterface public synchronized String beginExport(String filename, String mime, long size) {
            return active() ? buffer.begin(filename, mime, size) : "";
        }
        @JavascriptInterface public synchronized boolean appendExport(String nonce, String base64Chunk) {
            if (!active()) { buffer.clear(); return false; }
            return buffer.append(nonce, base64Chunk);
        }
        @JavascriptInterface public synchronized boolean completeExport(String nonce) {
            if (!active()) { buffer.clear(); return false; }
            ExportBuffer.Completed complete = buffer.complete(nonce);
            if (complete == null) return false;
            main.post(() -> {
                if (active() && trustedRoot(browser)) offerSave(new PendingSave(origin, null, null, complete.filename, complete.mime, complete.bytes));
                else java.util.Arrays.fill(complete.bytes, (byte) 0);
            });
            return true;
        }
        @JavascriptInterface public synchronized boolean cancelExport(String nonce) { return buffer.cancel(nonce); }
    }

    private final class HostClient extends WebViewClient {
        private final OriginPolicy origin;
        private final LocalStore store;
        HostClient(OriginPolicy origin, LocalStore store) { this.origin = origin; this.store = store; }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return intercept(origin, store, request);
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if ("qingdanapp".equals(request.getUrl().getScheme())) {
                if (request.isForMainFrame() && trustedRoot(view) && resumed) handleNativeCommand(url, request.hasGesture());
                return true;
            }
            if (!request.isForMainFrame()) return true;
            if (origin.route(url) == OriginPolicy.Route.ROOT) return false;
            if (!origin.isLocal() && origin.route(url) == OriginPolicy.Route.API && "GET".equals(request.getMethod()) && trustedRoot(view)) {
                offerSave(new PendingSave(origin, url, view.getSettings().getUserAgentString(), "qingdan-download", "application/octet-stream", null));
            } else if (request.hasGesture()) toast(NativeLanguage.text("navigation.blocked"));
            return true;
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            if (view == browser) nativeDocumentReady = false;
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (trustedRoot(view)) { nativeDocumentReady = true; reportLanguage(); reportKeyboardVisibility(); evaluateLifecycle(resumed ? "resume" : "pause"); reportNotificationPermission(notificationPermission()); }
        }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == browser) {
                destroyBrowser();
                showNativeError(NativeLanguage.text("page.process.stopped"), null);
            }
            return true;
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel(); toast(NativeLanguage.text("server.certificate.invalid"));
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) toast(NativeLanguage.text("page.open.failed"));
        }
    }

    private WebResourceResponse intercept(OriginPolicy origin, LocalStore store, WebResourceRequest request) {
        String url = request.getUrl().toString();
        OriginPolicy.Route route = origin.route(url);
        if (route == OriginPolicy.Route.BLOCKED) return blocked(403, "Forbidden");
        if (route == OriginPolicy.Route.API) {
            if (request.isForMainFrame()) return blocked(403, "Forbidden");
            if (origin.isLocal()) {
                if (store != null && "GET".equals(request.getMethod())) return store.interceptLocalApi(request.getUrl());
                return blocked(403, "Forbidden");
            }
            // GET/HEAD are proxied natively to inspect each redirect (including image URLs).
            // POST bodies are unavailable to WebViewClient; bundled fetch uses redirect:error
            // and the WebView network stack preserves HttpOnly cookies, methods and bodies.
            if ("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod())) {
                return interceptRemoteRead(origin, request);
            }
            return null;
        }
        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) return blocked(405, "Method Not Allowed");
        if (request.isForMainFrame() && route != OriginPolicy.Route.ROOT) return blocked(403, "Forbidden");
        String path = request.getUrl().getPath();
        String asset = route == OriginPolicy.Route.ROOT ? "web/index.html" : "web" + path;
        try {
            boolean languageBootstrap = "/assets/qingdan-native-language.js".equals(path);
            InputStream body;
            if ("HEAD".equals(request.getMethod())) body = new ByteArrayInputStream(new byte[0]);
            else if (languageBootstrap) body = new ByteArrayInputStream(NativeLanguage.bootstrapScript().getBytes(StandardCharsets.UTF_8));
            else if (route == OriginPolicy.Route.ROOT) {
                // Seed only the interface preference before the bundled application executes.
                // It is an external same-origin script under the existing strict APK CSP.
                ByteArrayOutputStream html = new ByteArrayOutputStream();
                try (InputStream input = getAssets().open(asset)) {
                    byte[] buffer = new byte[4096]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (html.size() + count > 262144) throw new IOException("Bundled page is too large");
                        html.write(buffer, 0, count);
                    }
                }
                String document = new String(html.toByteArray(), StandardCharsets.UTF_8).replace("<head>", "<head><script src=\"/assets/qingdan-native-language.js\"></script>");
                body = new ByteArrayInputStream(document.getBytes(StandardCharsets.UTF_8));
            } else body = getAssets().open(asset);
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", origin.contentSecurityPolicy());
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Referrer-Policy", "no-referrer");
            headers.put("Cross-Origin-Resource-Policy", "same-origin");
            headers.put("Cache-Control", route == OriginPolicy.Route.ROOT || languageBootstrap ? "no-store" : "public, max-age=31536000, immutable");
            return new WebResourceResponse(mimeFor(asset), "UTF-8", 200, "OK", headers, body);
        } catch (IOException error) { return blocked(404, "Not Found"); }
    }

    static WebResourceResponse blocked(int code, String reason) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("Content-Security-Policy", "default-src 'none'");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse("text/plain", "UTF-8", code, reason, headers,
                new ByteArrayInputStream(NativeLanguage.text("request.blocked").getBytes(StandardCharsets.UTF_8)));
    }

    private static String mimeFor(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".json") || lower.endsWith(".map")) return "application/json";
        return "application/octet-stream";
    }

    private final class HostChromeClient extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!trustedRoot(view) || params.getMode() == FileChooserParams.MODE_SAVE) { callback.onReceiveValue(null); return true; }
            if (uploadCallback != null) { callback.onReceiveValue(null); toast(NativeLanguage.text("file.selection.pending")); return true; }
            uploadCallback = callback;
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            String[] accepted = params.getAcceptTypes();
            List<String> mime = new ArrayList<>();
            if (accepted != null) for (String item : accepted) {
                if (item != null && item.matches("[A-Za-z0-9!#$&^_.+-]+/(?:[A-Za-z0-9!#$&^_.+-]+|\\*)")) mime.add(item);
            }
            picker.setType(mime.size() == 1 ? mime.get(0) : "*/*");
            if (mime.size() > 1) picker.putExtra(Intent.EXTRA_MIME_TYPES, mime.toArray(new String[0]));
            picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivityForResult(picker, PICK_UPLOAD); }
            catch (ActivityNotFoundException error) { uploadCallback.onReceiveValue(null); uploadCallback = null; toast(NativeLanguage.text("file.picker.unavailable")); }
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
    }

    private void handleNativeCommand(String url, boolean gesture) {
        Uri uri = Uri.parse(url);
        String command = uri.getHost();
        try {
            if ("language".equals(command)) {
                setNativeLanguage(NativeLanguage.parseCommand(url));
            } else if ("export".equals(command)) {
                ExportPayload payload = ExportPayload.parse(url);
                offerSave(new PendingSave(policy, null, null, payload.filename, payload.mime, payload.bytes));
            } else if ("notifications".equals(command)) {
                ExportPayload.query(url, "notifications", 1024);
                requestNotifications(gesture);
            } else if ("notify".equals(command)) {
                Map<String, String> query = ExportPayload.query(url, "notify", 4096);
                showNotification(query.get("title"), query.containsKey("body") ? query.get("body") : query.get("message"));
            }
        } catch (IllegalArgumentException error) { toast(error.getMessage()); }
    }

    private void offerSave(PendingSave save) {
        if (pendingSave != null) { save.erase(); toast(NativeLanguage.text("file.save.pending")); return; }
        if (save.sourceUrl != null && (save.origin.isLocal() || save.origin.route(save.sourceUrl) != OriginPolicy.Route.API)) { save.erase(); return; }
        pendingSave = save;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(save.mime).putExtra(Intent.EXTRA_TITLE, save.filename);
        try { startActivityForResult(intent, SAVE_DOWNLOAD); }
        catch (ActivityNotFoundException error) { pendingSave.erase(); pendingSave = null; toast(NativeLanguage.text("file.save.picker.unavailable")); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_UPLOAD) {
            ValueCallback<Uri[]> callback = uploadCallback; uploadCallback = null;
            if (callback == null) return;
            List<Uri> selected = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) for (int i = 0; i < Math.min(data.getClipData().getItemCount(), 100); i++) {
                    Uri uri = data.getClipData().getItemAt(i).getUri(); if (uri != null && "content".equals(uri.getScheme())) selected.add(uri);
                }
                else if (data.getData() != null && "content".equals(data.getData().getScheme())) selected.add(data.getData());
            }
            callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
        } else if (request == SAVE_DOWNLOAD) {
            PendingSave save = pendingSave; pendingSave = null;
            if (save == null) return;
            Uri destination = result == RESULT_OK && data != null ? data.getData() : null;
            if (destination == null || !"content".equals(destination.getScheme())) { save.erase(); return; }
            toast(NativeLanguage.text("file.saving"));
            io.execute(() -> {
                try {
                    try (OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                        if (output == null) throw new IOException(NativeLanguage.text("file.write.failed"));
                        if (save.bytes != null) output.write(save.bytes);
                        else download(save, output);
                        output.flush();
                    }
                    main.post(() -> toast(NativeLanguage.text("file.saved")));
                } catch (Exception error) {
                    // The destination is user-owned: do not silently delete it after a partial write.
                    main.post(() -> toast(NativeLanguage.text("file.save.failed")));
                } finally { save.erase(); }
            });
        }
    }

    private void download(PendingSave save, OutputStream output) throws IOException {
        String current = save.sourceUrl;
        long deadline = android.os.SystemClock.elapsedRealtime() + 90_000;
        for (int redirect = 0; redirect <= 3; redirect++) {
            if (save.origin.route(current) != OriginPolicy.Route.API) throw new IOException(NativeLanguage.text("download.origin.invalid"));
            HttpsURLConnection connection = (HttpsURLConnection) new java.net.URL(current).openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15_000); connection.setReadTimeout(20_000);
            connection.setRequestProperty("User-Agent", save.agent == null ? "QingdanAndroid/0.1" : save.agent);
            connection.setRequestProperty("Accept-Encoding", "identity");
            String cookie = CookieManager.getInstance().getCookie(current);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status <= 399) {
                    String location = connection.getHeaderField("Location");
                    URI base = OriginPolicy.uri(current);
                    if (location == null || base == null) throw new IOException(NativeLanguage.text("download.redirect.invalid"));
                    try { current = base.resolve(location).toString(); }
                    catch (IllegalArgumentException error) { throw new IOException(NativeLanguage.text("download.redirect.invalid")); }
                    if (save.origin.route(current) != OriginPolicy.Route.API) throw new IOException(NativeLanguage.text("download.redirect.blocked"));
                    if (redirect == 3) throw new IOException(NativeLanguage.text("download.redirect.excessive"));
                    continue;
                }
                if (status < 200 || status > 299) throw new IOException(NativeLanguage.text("server.response.status") + " " + status);
                if (connection.getContentLengthLong() > ExportPayload.MAX_BYTES) throw new IOException(NativeLanguage.text("download.size.limit"));
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[16 * 1024]; long count = 0; int read;
                    while ((read = input.read(buffer)) != -1) {
                        if (android.os.SystemClock.elapsedRealtime() > deadline) throw new IOException(NativeLanguage.text("download.timeout"));
                        count += read; if (count > ExportPayload.MAX_BYTES) throw new IOException(NativeLanguage.text("download.size.limit"));
                        output.write(buffer, 0, read);
                    }
                }
                return;
            } finally { connection.disconnect(); }
        }
        throw new IOException(NativeLanguage.text("download.redirect.excessive"));
    }

    private WebResourceResponse interceptRemoteRead(OriginPolicy origin, WebResourceRequest request) {
        String current = request.getUrl().toString();
        for (int redirect = 0; redirect <= 3; redirect++) {
            HttpsURLConnection connection = null;
            boolean receivedResponse = false;
            try {
                if (origin.route(current) != OriginPolicy.Route.API) return blocked(403, "Forbidden");
                connection = (HttpsURLConnection) new java.net.URL(current).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15_000); connection.setReadTimeout(20_000);
                connection.setRequestMethod(request.getMethod());
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("User-Agent", "QingdanAndroid/0.1");
                connection.setRequestProperty("Origin", origin.origin());
                connection.setRequestProperty("Sec-Fetch-Site", "same-origin");
                // Forward only useful request headers, never Origin/Host or arbitrary credentials.
                for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                    String key = header.getKey().toLowerCase(Locale.ROOT);
                    if (key.equals("accept") || key.equals("x-qingdan") || key.equals("x-qingdan-csrf") || key.equals("x-qingdan-expected-account")) {
                        connection.setRequestProperty(header.getKey(), header.getValue());
                    }
                }
                String cookie = CookieManager.getInstance().getCookie(current);
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                int status = connection.getResponseCode();
                receivedResponse = true;
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (header.getKey() != null && "set-cookie".equalsIgnoreCase(header.getKey())) {
                        for (String value : header.getValue()) CookieManager.getInstance().setCookie(current, value);
                    }
                }
                if (status >= 300 && status <= 399 && status != 304) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || redirect == 3) { connection.disconnect(); return blocked(502, "Bad Gateway"); }
                    URI base = OriginPolicy.uri(current);
                    if (base == null) { connection.disconnect(); return blocked(403, "Forbidden"); }
                    String next = base.resolve(location).toString();
                    connection.disconnect(); connection = null;
                    if (origin.route(next) != OriginPolicy.Route.API) return blocked(403, "Forbidden");
                    current = next; continue;
                }
                if (status < 200 || status > 599 || status == 304) { connection.disconnect(); return blocked(502, "Bad Gateway"); }
                if (connection.getContentLengthLong() > ExportPayload.MAX_BYTES) { connection.disconnect(); return blocked(413, "Content Too Large"); }
                Map<String, String> headers = new HashMap<>();
                for (String key : new String[]{"Content-Type", "Content-Disposition", "Cache-Control", "ETag", "Last-Modified"}) {
                    String value = connection.getHeaderField(key); if (value != null) headers.put(key, value);
                }
                headers.put("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Cross-Origin-Resource-Policy", "same-origin");
                String contentType = connection.getContentType();
                String mime = contentType == null ? "application/octet-stream" : contentType.split(";", 2)[0].trim();
                String reason = connection.getResponseMessage();
                if (reason == null || reason.isEmpty() || !reason.matches("[ -~]+")) reason = "Response";
                InputStream body;
                if ("HEAD".equals(request.getMethod()) || status == 204 || status == 304) {
                    body = new ByteArrayInputStream(new byte[0]); connection.disconnect(); connection = null;
                } else {
                    InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    if (input == null) { body = new ByteArrayInputStream(new byte[0]); connection.disconnect(); connection = null; }
                    else {
                        final HttpsURLConnection owned = connection;
                        body = new FilterInputStream(input) {
                            long size; final long until = android.os.SystemClock.elapsedRealtime() + 90_000;
                            private void bounded(int read) throws IOException {
                                if (read > 0) size += read;
                                if (size > ExportPayload.MAX_BYTES || android.os.SystemClock.elapsedRealtime() > until) {
                                    close(); throw new IOException("API read exceeded size/time limit");
                                }
                            }
                            @Override public int read() throws IOException { int value = in.read(); bounded(value < 0 ? 0 : 1); return value; }
                            @Override public int read(byte[] buffer, int offset, int length) throws IOException { int value = in.read(buffer, offset, length); bounded(value); return value; }
                            @Override public void close() throws IOException { try { super.close(); } finally { owned.disconnect(); } }
                        };
                        connection = null; // stream owns disconnect after response delivery
                    }
                }
                return new WebResourceResponse(ExportPayload.safeMime(mime), "UTF-8", status, reason, headers, body);
            } catch (Exception error) {
                if (connection != null) connection.disconnect();
                if (error instanceof javax.net.ssl.SSLException) return apiFailure("TLS_INVALID", NativeLanguage.text("server.tls.invalid"));
                if (!receivedResponse && error instanceof IOException) return apiFailure("NETWORK_ERROR", NativeLanguage.text("server.network.unavailable"));
                return blocked(502, "Bad Gateway");
            }
        }
        return blocked(502, "Bad Gateway");
    }

    private static WebResourceResponse apiFailure(String code, String message) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'");
        String body = "{\"error\":\"" + message + "\",\"code\":\"" + code + "\"}";
        return new WebResourceResponse("application/json", "UTF-8", 503, "Service Unavailable", headers,
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static final class PendingSave {
        final OriginPolicy origin; final String sourceUrl; final String agent; final String filename; final String mime;
        byte[] bytes;
        PendingSave(OriginPolicy origin, String url, String agent, String filename, String mime, byte[] bytes) {
            this.origin = origin; this.sourceUrl = url; this.agent = agent;
            this.filename = ExportPayload.safeFilename(filename); this.mime = ExportPayload.safeMime(mime); this.bytes = bytes;
        }
        void erase() { if (bytes != null) { java.util.Arrays.fill(bytes, (byte) 0); bytes = null; } }
    }

    private void refreshNativeLabels() {
        setTitle(NativeLanguage.text("app.name"));
        if (settingsButton != null) settingsButton.setText(NativeLanguage.text("settings.mode"));
        if (modeLabel != null) modeLabel.setText(policy == null ? NativeLanguage.text("app.name") : NativeLanguage.text(policy.isLocal() ? "mode.local.title" : "mode.server.title"));
        createNotificationChannel();
    }
    private boolean setNativeLanguage(String value) {
        if (!NativeLanguage.validPreference(value)) return false;
        if (!preferences.edit().putString("language", value).commit()) { toast(NativeLanguage.text("language.save.failed")); reportLanguage(); return false; }
        NativeLanguage.setPreference(value);
        refreshNativeLabels();
        reportLanguage();
        return true;
    }
    private void reportLanguage() {
        if (!nativeDocumentReady || !trustedRoot(browser)) return;
        // Both values come only from the closed enum, never page-controlled script.
        String value = NativeLanguage.preference(), locale = NativeLanguage.locale();
        browser.evaluateJavascript("window.__QINGDAN_NATIVE_LOCALE__='" + locale + "';window.__QINGDAN_NATIVE_LANGUAGE__='" + value + "';window.__QINGDAN_NATIVE_LANGUAGE_READY__=true;window.__qingdanSetLanguagePreference&&window.__qingdanSetLanguagePreference('" + value + "');", null);
    }

    private void createNotificationChannel() {
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("focus", NativeLanguage.text("notifications.focus"), NotificationManager.IMPORTANCE_DEFAULT));
    }
    private void requestNotifications(boolean gesture) {
        if (notificationRequestPending) return;
        if (!gesture && !"granted".equals(notificationPermission())) {
            notificationRequestPending = true;
            // Async JS handlers may lose Chromium's transient gesture bit. An explicit
            // native consent button keeps the permission request user-initiated.
            new AlertDialog.Builder(this).setTitle(NativeLanguage.text("notifications.enable.title"))
                    .setMessage(NativeLanguage.text("notifications.enable.description"))
                    .setNegativeButton(NativeLanguage.text("notifications.not.now"), (d, w) -> { notificationRequestPending = false; reportNotificationPermission(notificationPermission()); })
                    .setPositiveButton(NativeLanguage.text("common.continue"), (d, w) -> { notificationRequestPending = false; requestNotifications(true); })
                    .setOnCancelListener(d -> { notificationRequestPending = false; reportNotificationPermission(notificationPermission()); }).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationRequestPending = true;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
        } else reportNotificationPermission(notificationPermission());
    }
    private String notificationPermission() {
        if (!getSystemService(NotificationManager.class).areNotificationsEnabled()) return "denied";
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return "default";
        return "granted";
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NOTIFICATION_PERMISSION) { notificationRequestPending = false; reportNotificationPermission(notificationPermission()); }
    }
    private void reportNotificationPermission(String result) {
        if (trustedRoot(browser)) browser.evaluateJavascript("window.__qingdanAndroidNotificationPermission&&window.__qingdanAndroidNotificationPermission('" + result + "')", null);
    }
    private void showNotification(String title, String body) {
        if (!resumed || !"granted".equals(notificationPermission())) return;
        String safeTitle = title == null || title.isEmpty() ? NativeLanguage.text("app.name") : title.substring(0, Math.min(title.length(), 120));
        String safeBody = body == null ? "" : body.substring(0, Math.min(body.length(), 500));
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, "focus").setSmallIcon(cn.qingdan.android.R.drawable.ic_qingdan)
                .setContentTitle(safeTitle).setContentText(safeBody).setContentIntent(open).setAutoCancel(true).build();
        getSystemService(NotificationManager.class).notify(1, notification);
    }

    @Override public void onBackPressed() { handleBack(); }
    private void handleBack() {
        if (backPending) return;
        if (!trustedRoot(browser)) { moveTaskToBack(true); return; }
        backPending = true;
        final int requestGeneration = generation;
        Runnable fallback = () -> { if (backPending && generation == requestGeneration) { backPending = false; moveTaskToBack(true); } };
        main.postDelayed(fallback, 700);
        browser.evaluateJavascript("(function(){try{return typeof window.__qingdanAndroidBack==='function'&&window.__qingdanAndroidBack()===true}catch(e){return false}})()", result -> {
            if (generation != requestGeneration || !backPending) return;
            main.removeCallbacks(fallback); backPending = false;
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }
    private void updateKeyboardVisibility(boolean visible) {
        if (keyboardVisible == visible) return;
        keyboardVisible = visible;
        reportKeyboardVisibility();
    }
    private void reportKeyboardVisibility() {
        if (nativeDocumentReady && trustedRoot(browser)) {
            browser.evaluateJavascript("window.__qingdanAndroidKeyboardVisible=" + (keyboardVisible ? "true" : "false"), null);
        }
    }
    private void evaluateLifecycle(String phase) {
        if (trustedRoot(browser)) browser.evaluateJavascript("window.__qingdanAndroidLifecycle&&window.__qingdanAndroidLifecycle('" + phase + "')", null);
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true;
        if (browser != null) { refreshNativeLabels(); reportLanguage(); browser.onResume(); evaluateLifecycle("resume"); reportNotificationPermission(notificationPermission()); }
    }
    @Override protected void onPause() {
        resumed = false; evaluateLifecycle("pause");
        if (browser != null) browser.onPause();
        CookieManager.getInstance().flush(); super.onPause();
    }
    @Override protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        destroyBrowser(); io.shutdown(); super.onDestroy();
    }
    private void toast(String message) { main.post(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show()); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
