package app.stnew.termux;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebBackForwardList;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;

public final class MainActivity extends Activity {
    private static final String HOST = "127.0.0.1";
    private static final int DEFAULT_PORT = 8000;
    private static final int PICK_FILE = 1;
    private static final int PAPER = 0xfff3eee4;
    private static final String ACCOUNT_LOGIN_PATH = "/app/login.html";

    private WebView webView;
    private LinearLayout errorPanel;
    private TextView errorMessage;
    private ValueCallback<Uri[]> fileSelection;
    private FileExports fileExports;
    private LoginPanel loginPanel;
    private EditText loginUsername;
    private EditText loginPassword;
    private HttpAuthHandler authRequest;
    private WebMessagePort accountLoginPort;
    private boolean signingIn;
    private WebMessagePort shellPort;
    private final Handler sendDelayHandler = new Handler(Looper.getMainLooper());
    private Runnable sendDelayTimer;
    private String pendingSendId;
    private String shellScript;
    private boolean checkingUpdate;
    private int port;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        fileExports = new FileExports(this, state);
        port = getPreferences(MODE_PRIVATE).getInt("port", DEFAULT_PORT);
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        applySystemBarColor(PAPER);
        try (InputStream script = getAssets().open("tavern-shell.js")) {
            shellScript = ApkReleases.readUtf8(script);
        } catch (IOException error) {
            Log.e("ST New", "Unable to load the Android shell script", error);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(PAPER);
        webView = new WebView(this);
        webView.setBackgroundColor(PAPER);
        // Use the page's typography instead of inheriting Android's font scale.
        webView.getSettings().setTextZoom(100);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.setWebViewClient(new TavernClient());
        webView.setWebChromeClient(new TavernChromeClient());
        webView.setDownloadListener((url, userAgent, disposition, mimeType, size) ->
                downloadFile(url, disposition, mimeType));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        errorPanel.setPadding(padding, padding, padding, padding);
        errorPanel.setBackgroundColor(PAPER);
        errorMessage = new TextView(this);
        errorMessage.setGravity(Gravity.CENTER);
        errorMessage.setTextSize(17);
        errorPanel.addView(errorMessage);
        addButton("重试", this::loadTavern);
        addButton("修改端口", this::editPort);
        addButton("检查 APK 更新", this::checkApkUpdate);
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        createLoginPanel(root);
        setContentView(root);

        if (state == null || state.getBoolean("loginPending") || webView.restoreState(state) == null) {
            loadTavern();
        } else if (state.containsKey("connectionError")) {
            showError(state.getString("connectionError"));
        }
    }

    private void addButton(String title, Runnable onClick) {
        Button button = new Button(this);
        button.setText(title);
        button.setOnClickListener(view -> onClick.run());
        errorPanel.addView(button);
    }

    private String appUrl() {
        return serverOrigin() + "/app/";
    }

    private String serverOrigin() {
        return "http://" + HOST + ":" + port;
    }

    private boolean isTavern(Uri uri) {
        return "http".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && (uri.getPort() == port || (port == 80 && uri.getPort() == -1))
                && uri.getUserInfo() == null;
    }

    private void loadTavern() {
        closeLogin();
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        webView.stopLoading();
        webView.loadUrl(appUrl());
    }

    private void showError(String message) {
        closeLogin();
        applySystemBarColor(PAPER);
        errorMessage.setText(message);
        webView.setVisibility(View.INVISIBLE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void applySystemBarColor(int color) {
        applySystemBarColors(color, color);
    }

    private void applySystemBarColors(int statusColor, int navigationColor) {
        Window window = getWindow();
        View decor = window.getDecorView();
        boolean lightNavigation = Color.luminance(navigationColor) > 0.179;
        int appearance = decor.getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Color.luminance(statusColor) > 0.179) {
            appearance |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            appearance &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            if (lightNavigation) {
                appearance |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        }
        decor.setSystemUiVisibility(appearance);
        window.setStatusBarColor(statusColor);
        if (Build.VERSION.SDK_INT < 26 && lightNavigation) navigationColor = 0xff64594b;
        window.setNavigationBarColor(navigationColor);
        if (Build.VERSION.SDK_INT >= 28) {
            window.setNavigationBarDividerColor(navigationColor);
        }
    }

    private void connectShell(WebView view, String url) {
        if (shellScript == null || shellPort != null || !Uri.parse(url).getPath().startsWith("/app/")) {
            return;
        }
        WebMessagePort[] ports = view.createWebMessageChannel();
        WebMessagePort nativePort = ports[0];
        shellPort = nativePort;
        nativePort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override
            public void onMessage(WebMessagePort port, WebMessage message) {
                String data = message.getData();
                if (port != shellPort || data == null || errorPanel.getVisibility() != View.GONE) {
                    return;
                }
                if (data.matches("#[0-9a-fA-F]{6}")) {
                    applySystemBarColor(Color.parseColor(data));
                } else if (data.matches("system-bars:#[0-9a-fA-F]{6}:#[0-9a-fA-F]{6}")) {
                    String[] colors = data.split(":");
                    applySystemBarColors(Color.parseColor(colors[1]), Color.parseColor(colors[2]));
                } else if ("check-apk-update".equals(data)) {
                    checkApkUpdate();
                } else if (data.startsWith("send-delay-start:")) {
                    startSendDelay(port, data);
                } else if (data.equals("send-delay-end:" + pendingSendId)) {
                    endSendDelay();
                } else if (data.startsWith("export-")) {
                    fileExports.onMessage(port, data);
                }
            }
        });
        view.evaluateJavascript(shellScript, result -> {
            if (shellPort == nativePort && url.equals(view.getUrl())) {
                view.postWebMessage(new WebMessage("st-new-android-shell", new WebMessagePort[]{ports[1]}),
                        Uri.parse(serverOrigin()));
            } else {
                ports[1].close();
            }
        });
    }

    private void disconnectShell() {
        endSendDelay();
        fileExports.cancelTransfer();
        if (shellPort != null) {
            shellPort.close();
            shellPort = null;
        }
    }

    private void startSendDelay(WebMessagePort port, String data) {
        if (!data.matches("send-delay-start:[0-9]{1,15}:[0-9]{1,10}")) return;
        String[] fields = data.split(":");
        String id = fields[1];
        long delay = Long.parseLong(fields[2]);
        if (delay < 1 || delay > Integer.MAX_VALUE) return;
        if (sendDelayTimer != null) sendDelayHandler.removeCallbacks(sendDelayTimer);
        boolean startService = pendingSendId == null;
        pendingSendId = id;
        sendDelayTimer = () -> {
            if (port == shellPort && id.equals(pendingSendId)) {
                port.postMessage(new WebMessage("send-delay-ready:" + id));
            }
        };
        sendDelayHandler.postDelayed(sendDelayTimer, delay);
        if (startService) {
            try {
                // The user starts the delay from the activity. The service promotes itself
                // immediately and can be stopped even if the page cancels before it starts.
                startService(new Intent(this, PendingSendService.class));
            } catch (IllegalStateException | SecurityException error) {
                Log.w("ST New", "Unable to keep the pending send active", error);
            }
        }
    }

    private void endSendDelay() {
        if (pendingSendId == null) return;
        pendingSendId = null;
        sendDelayHandler.removeCallbacks(sendDelayTimer);
        sendDelayTimer = null;
        stopService(new Intent(this, PendingSendService.class));
    }

    private void downloadFile(String url, String disposition, String mimeType) {
        String resource = url.startsWith("blob:") ? url.substring("blob:".length()) : url;
        if (shellPort == null || (!url.startsWith("data:") && !isTavern(Uri.parse(resource)))) {
            Toast.makeText(this, "无法在 APK 中保存此下载链接。", Toast.LENGTH_SHORT).show();
            return;
        }
        String filename = URLUtil.guessFileName(url, disposition, mimeType);
        shellPort.postMessage(new WebMessage("download:{\"url\":" + JSONObject.quote(url)
                + ",\"name\":" + JSONObject.quote(filename) + "}"));
    }

    private void checkApkUpdate() {
        if (checkingUpdate) {
            return;
        }
        checkingUpdate = true;
        Toast.makeText(this, "正在检查 APK 更新…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                int installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                ApkReleases.Release release = ApkReleases.fetch();
                runOnUiThread(() -> showApkUpdate(installed, release));
            } catch (IOException | JSONException | PackageManager.NameNotFoundException error) {
                Log.w("ST New", "Unable to check GitHub Releases", error);
                runOnUiThread(() -> {
                    checkingUpdate = false;
                    if (!isFinishing() && !isDestroyed()) {
                        Toast.makeText(this, "无法检查 APK 更新，请确认手机能访问 GitHub 后重试。",
                                Toast.LENGTH_LONG).show();
                    }
                });
            }
        }, "apk-update-check").start();
    }

    private void showApkUpdate(int installed, ApkReleases.Release release) {
        checkingUpdate = false;
        if (isFinishing() || isDestroyed()) {
            return;
        }
        if (release == null || release.versionCode <= installed) {
            String message = release == null ? "GitHub 暂无已发布的 APK。" : "当前已是最新 APK。";
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("有新版 APK")
                .setMessage(release.name + "\n下载后用 Android 安装器覆盖安装。")
                .setNegativeButton("取消", null)
                .setPositiveButton("前往下载", (dialog, which) -> openBrowser(Uri.parse(release.downloadUrl)))
                .show();
    }

    private void editPort() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setText(Integer.toString(port));
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Termux 中 SillyTavern 的端口")
                .setView(input)
                .setNegativeButton("取消", null)
                .setPositiveButton("连接", null)
                .create();
        dialog.setOnShowListener(unused -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(view -> {
                    int newPort;
                    try {
                        newPort = Integer.parseInt(input.getText().toString().trim());
                    } catch (NumberFormatException error) {
                        newPort = 0;
                    }
                    if (newPort < 1 || newPort > 65535) {
                        input.setError("请输入 1 到 65535 之间的端口");
                        return;
                    }
                    port = newPort;
                    getPreferences(MODE_PRIVATE).edit().putInt("port", port).apply();
                    dialog.dismiss();
                    loadTavern();
                }));
        dialog.show();
    }

    private void openBrowser(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "找不到可打开链接的浏览器。", Toast.LENGTH_SHORT).show();
        }
    }

    private void createLoginPanel(FrameLayout root) {
        loginPanel = new LoginPanel(this);
        loginPanel.setVisibility(View.GONE);
        loginUsername = loginPanel.username;
        loginPassword = loginPanel.password;
        loginUsername.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        loginUsername.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_NEXT) return false;
            loginPassword.requestFocus();
            return true;
        });
        loginPassword.setImeOptions(EditorInfo.IME_ACTION_DONE);
        loginPassword.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_DONE) return false;
            submitLogin();
            return true;
        });

        loginPanel.submit.setOnClickListener(view -> submitLogin());
        loginPanel.back.setOnClickListener(view -> cancelLogin());
        root.addView(loginPanel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showLogin(HttpAuthHandler handler) {
        boolean rejected = signingIn && !handler.useHttpAuthUsernamePassword();
        authRequest = handler;
        signingIn = false;
        showLoginForm(rejected ? "用户名或密码有误，请重试。" : null);
    }

    private void showLoginForm(String failure) {
        applySystemBarColors(LoginPanel.TOP_COLOR, PAPER);
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        loginPanel.setVisibility(View.VISIBLE);
        loginPanel.showForm(HOST + ":" + port, failure, isAccountSwitch());
        if (failure != null) loginPassword.requestFocus();
        else loginPanel.requestFocus();
    }

    private void connectAccountLogin(WebView view, String url) {
        if (accountLoginPort != null) return;
        WebMessagePort[] ports = view.createWebMessageChannel();
        accountLoginPort = ports[0];
        accountLoginPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override
            public void onMessage(WebMessagePort port, WebMessage message) {
                if (port != accountLoginPort || !url.equals(view.getUrl())) return;
                try {
                    JSONObject payload = new JSONObject(message.getData());
                    if ("ready".equals(payload.optString("type"))) {
                        loginUsername.setText(payload.optString("handle"));
                        showLoginForm(null);
                    } else if ("error".equals(payload.optString("type"))) {
                        showLoginForm(payload.optString("message", "登录失败，请重试。"));
                    }
                } catch (JSONException ignored) { }
            }
        });
        view.postWebMessage(new WebMessage("st-new-android-account-login", new WebMessagePort[]{ports[1]}), Uri.parse(serverOrigin()));
    }

    private void submitLogin() {
        if ((authRequest == null && accountLoginPort == null) || !loginPanel.submit.isEnabled()) return;
        String username = loginUsername.getText().toString();
        if (authRequest == null) username = username.trim();
        String password = loginPassword.getText().toString();
        if (username.isEmpty() || username.contains(":")) {
            loginUsername.setError(username.isEmpty() ? "请输入用户名" : "用户名不能包含冒号");
            loginUsername.requestFocus();
            return;
        }
        if (password.isEmpty()) {
            loginPassword.setError("请输入密码");
            loginPassword.requestFocus();
            return;
        }
        HttpAuthHandler handler = authRequest;
        authRequest = null;
        signingIn = true;
        loginPanel.showSubmitting();
        loginPassword.setText("");
        hideLoginKeyboard();
        if (handler != null) handler.proceed(username, password);
        else {
            signingIn = false;
            accountLoginPort.postMessage(new WebMessage("{\"handle\":" + JSONObject.quote(username)
                    + ",\"password\":" + JSONObject.quote(password) + "}"));
        }
    }

    private void hideLoginKeyboard() {
        getSystemService(InputMethodManager.class).hideSoftInputFromWindow(loginPanel.getWindowToken(), 0);
    }

    private void closeLogin() {
        HttpAuthHandler handler = authRequest;
        authRequest = null;
        if (accountLoginPort != null) {
            accountLoginPort.close();
            accountLoginPort = null;
        }
        signingIn = false;
        if (loginPanel.getVisibility() == View.VISIBLE) {
            hideLoginKeyboard();
            loginPanel.setVisibility(View.GONE);
            getWindow().setStatusBarColor(PAPER);
            loginUsername.setText("");
            loginUsername.setError(null);
            loginPassword.setText("");
            loginPassword.setError(null);
        }
        if (handler != null) handler.cancel();
    }

    private void cancelLogin() {
        if (isAccountSwitch()) {
            loadTavern();
            return;
        }
        showError("登录已取消。");
        webView.stopLoading();
    }

    private boolean isAccountSwitch() {
        String url = webView.getUrl();
        if (url == null) return false;
        Uri page = Uri.parse(url);
        return isTavern(page) && ACCOUNT_LOGIN_PATH.equals(page.getPath())
                && "1".equals(page.getQueryParameter("switch"));
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Android may reclaim the process before WebView's scheduled cookie write.
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        fileExports.saveState(state);
        String currentUrl = webView.getUrl();
        if (loginPanel.getVisibility() == View.VISIBLE
                || (currentUrl != null && ACCOUNT_LOGIN_PATH.equals(Uri.parse(currentUrl).getPath()))) {
            // Start again at /app/ so the server can use any committed login session.
            state.putBoolean("loginPending", true);
        } else {
            webView.saveState(state);
        }
        if (errorPanel.getVisibility() == View.VISIBLE) {
            state.putString("connectionError", errorMessage.getText().toString());
        }
    }

    @Override
    public void onBackPressed() {
        if (loginPanel.getVisibility() == View.VISIBLE) {
            cancelLogin();
            return;
        }
        WebBackForwardList history = webView.copyBackForwardList();
        if (errorPanel.getVisibility() == View.GONE && history.getCurrentIndex() > 0
                && isTavern(Uri.parse(history.getItemAtIndex(history.getCurrentIndex() - 1).getUrl()))) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FileExports.SAVE_FILE) {
            fileExports.onActivityResult(resultCode, data);
        } else if (requestCode == PICK_FILE && fileSelection != null) {
            Uri[] selection = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if (selection != null) {
                for (Uri file : selection) {
                    if (file == null || !"content".equals(file.getScheme())) {
                        selection = null;
                        break;
                    }
                }
            }
            fileSelection.onReceiveValue(selection);
            fileSelection = null;
        }
    }

    @Override
    protected void onDestroy() {
        disconnectShell();
        fileExports.destroy();
        closeLogin();
        if (fileSelection != null) {
            fileSelection.onReceiveValue(null);
            fileSelection = null;
        }
        ((FrameLayout) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }

    private final class TavernClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            disconnectShell();
            if (accountLoginPort != null) closeLogin();
        }

        @Override
        public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
            if (authRequest != null || errorPanel.getVisibility() == View.VISIBLE
                    || !(HOST.equals(host) || (HOST + ":" + port).equals(host))) {
                handler.cancel();
                return;
            }
            showLogin(handler);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Uri page = Uri.parse(url);
            if (authRequest == null && url.equals(view.getUrl())
                    && errorPanel.getVisibility() == View.GONE && isTavern(page)) {
                if ("/".equals(page.getPath())) {
                    view.evaluateJavascript("location.replace('/app/')", null);
                } else if (ACCOUNT_LOGIN_PATH.equals(page.getPath())) {
                    if (accountLoginPort == null) closeLogin();
                    webView.setVisibility(View.VISIBLE);
                    connectAccountLogin(view, url);
                } else {
                    if ("/app/".equals(page.getPath())) {
                        CookieManager.getInstance().flush();
                    }
                    closeLogin();
                    view.setVisibility(View.VISIBLE);
                    connectShell(view, url);
                }
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!request.isForMainFrame() || isTavern(url)) {
                return false;
            }
            if (request.hasGesture() && ("https".equals(url.getScheme()) || "http".equals(url.getScheme()))) {
                openBrowser(url);
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isTavern(request.getUrl())) {
                showError("无法连接 " + appUrl() + "\n请先在 Termux 启动 SillyTavern，再点重试。");
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (!request.isForMainFrame() || !isTavern(request.getUrl())) {
                return;
            }
            int status = response.getStatusCode();
            if (status == 401) {
                if (authRequest == null && errorPanel.getVisibility() == View.GONE) {
                    showError("SillyTavern 登录失败（HTTP 401）。\n请点重试。");
                }
            } else if (status == 429 && loginPanel.getVisibility() == View.VISIBLE) {
                showError("登录尝试过多，请稍后重试。");
            } else if ("/app/".equals(request.getUrl().getPath()) && status == 404) {
                showError("SillyTavern 已连接，但找不到 /app/。\n请在 Termux 安装 st_new 前端，再点重试。");
            } else {
                showError("SillyTavern 返回 HTTP " + status + "。\n请检查 Termux 里的酒馆服务，再点重试。");
            }
        }
    }

    private final class TavernChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            String currentUrl = view.getUrl();
            if (currentUrl == null || !isTavern(Uri.parse(currentUrl))) {
                callback.onReceiveValue(null);
                return true;
            }
            if (fileSelection != null) {
                fileSelection.onReceiveValue(null);
            }
            fileSelection = callback;
            try {
                startActivityForResult(params.createIntent(), PICK_FILE);
            } catch (ActivityNotFoundException error) {
                fileSelection = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, "找不到文件选择器。", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }
}
