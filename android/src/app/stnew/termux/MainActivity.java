package app.stnew.termux;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
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
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;

import java.io.IOException;
import java.io.InputStream;

public final class MainActivity extends Activity {
    private static final String HOST = "127.0.0.1";
    private static final int DEFAULT_PORT = 8000;
    private static final int PICK_FILE = 1;
    private static final int PAPER = 0xfff3eee4;

    private WebView webView;
    private LinearLayout errorPanel;
    private TextView errorMessage;
    private ValueCallback<Uri[]> fileSelection;
    private ScrollView loginPanel;
    private EditText loginUsername;
    private EditText loginPassword;
    private TextView loginStatus;
    private Button loginButton;
    private HttpAuthHandler authRequest;
    private boolean signingIn;
    private WebMessagePort shellPort;
    private String shellScript;
    private boolean checkingUpdate;
    private int port;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
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
                new AlertDialog.Builder(this)
                        .setMessage("请在手机浏览器中打开酒馆，再执行导出。")
                        .setNegativeButton("取消", null)
                        .setPositiveButton("打开浏览器", (dialog, which) -> openBrowser(Uri.parse(appUrl())))
                        .show());
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
        // SillyTavern routes unauthenticated sessions through /login from its root.
        webView.loadUrl(serverOrigin() + "/");
    }

    private void showError(String message) {
        closeLogin();
        applySystemBarColor(PAPER);
        errorMessage.setText(message);
        webView.setVisibility(View.INVISIBLE);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void applySystemBarColor(int color) {
        Window window = getWindow();
        View decor = window.getDecorView();
        boolean lightBackground = Color.luminance(color) > 0.179;
        int appearance = decor.getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (lightBackground) {
            appearance |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            appearance &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            if (lightBackground) {
                appearance |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        }
        decor.setSystemUiVisibility(appearance);
        window.setStatusBarColor(color);
        window.setNavigationBarColor(Build.VERSION.SDK_INT < 26 && lightBackground ? 0xff64594b : color);
        if (Build.VERSION.SDK_INT >= 28) {
            window.setNavigationBarDividerColor(color);
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
                } else if ("check-apk-update".equals(data)) {
                    checkApkUpdate();
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
        if (shellPort != null) {
            shellPort.close();
            shellPort = null;
        }
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
        loginPanel = new ScrollView(this);
        loginPanel.setFillViewport(true);
        loginPanel.setBackgroundColor(PAPER);
        loginPanel.setVisibility(View.GONE);
        if (Build.VERSION.SDK_INT >= 26) {
            loginPanel.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }

        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setGravity(Gravity.CENTER_VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        fields.setPadding(padding, padding, padding, padding);
        loginPanel.addView(fields);

        TextView title = new TextView(this);
        title.setText("登录 SillyTavern");
        title.setTextSize(28);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        if (Build.VERSION.SDK_INT >= 28) {
            title.setAccessibilityHeading(true);
        }
        fields.addView(title);

        loginStatus = new TextView(this);
        loginStatus.setTextSize(16);
        loginStatus.setPadding(0, padding / 2, 0, padding / 2);
        loginStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        fields.addView(loginStatus);

        loginUsername = addLoginField(fields, "用户名",
                InputType.TYPE_TEXT_VARIATION_NORMAL | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        loginPassword = addLoginField(fields, "密码", InputType.TYPE_TEXT_VARIATION_PASSWORD);
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

        loginButton = new Button(this);
        loginButton.setText("登录");
        loginButton.setOnClickListener(view -> submitLogin());
        fields.addView(loginButton);
        Button back = new Button(this);
        back.setText("返回连接设置");
        back.setOnClickListener(view -> cancelLogin());
        fields.addView(back);
        root.addView(loginPanel, new FrameLayout.LayoutParams(-1, -1));
    }

    private EditText addLoginField(LinearLayout fields, String hint, int variation) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | variation);
        input.setSaveEnabled(false);
        fields.addView(input);
        return input;
    }

    private void showLogin(HttpAuthHandler handler) {
        boolean rejected = signingIn && !handler.useHttpAuthUsernamePassword();
        authRequest = handler;
        signingIn = false;
        applySystemBarColor(PAPER);
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        loginPanel.setVisibility(View.VISIBLE);
        loginStatus.setText(rejected ? "用户名或密码有误，请重试。"
                : "请输入 " + HOST + ":" + port + " 上配置的账号和密码。");
        loginButton.setEnabled(true);
        if (rejected) loginPassword.requestFocus();
        else loginUsername.requestFocus();
    }

    private void submitLogin() {
        if (authRequest == null) return;
        String username = loginUsername.getText().toString();
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
        loginButton.setEnabled(false);
        loginStatus.setText("正在登录…");
        loginPassword.setText("");
        hideLoginKeyboard();
        handler.proceed(username, password);
    }

    private void hideLoginKeyboard() {
        getSystemService(InputMethodManager.class).hideSoftInputFromWindow(loginPanel.getWindowToken(), 0);
    }

    private void closeLogin() {
        HttpAuthHandler handler = authRequest;
        authRequest = null;
        signingIn = false;
        if (loginPanel.getVisibility() == View.VISIBLE) {
            hideLoginKeyboard();
            loginPanel.setVisibility(View.GONE);
            loginUsername.setText("");
            loginUsername.setError(null);
            loginPassword.setText("");
            loginPassword.setError(null);
        }
        if (handler != null) handler.cancel();
    }

    private void cancelLogin() {
        showError("登录已取消。");
        webView.stopLoading();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (loginPanel.getVisibility() == View.VISIBLE) {
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
        if (requestCode == PICK_FILE && fileSelection != null) {
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
                } else {
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
