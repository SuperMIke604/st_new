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
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
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
    private AlertDialog authDialog;
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
        setContentView(root);

        if (state == null || webView.restoreState(state) == null) {
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
        errorPanel.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        webView.stopLoading();
        // SillyTavern routes unauthenticated sessions through /login from its root.
        webView.loadUrl(serverOrigin() + "/");
    }

    private void showError(String message) {
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

    private void promptForHttpAuth(HttpAuthHandler handler) {
        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        fields.setPadding(padding, 0, padding, 0);

        EditText username = new EditText(this);
        username.setHint("用户名");
        username.setSingleLine(true);
        username.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        fields.addView(username);

        EditText password = new EditText(this);
        password.setHint("密码");
        password.setSingleLine(true);
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        fields.addView(password);

        authDialog = new AlertDialog.Builder(this)
                .setTitle("SillyTavern 需要登录")
                .setMessage("请输入 " + HOST + ":" + port + " 的 HTTP Basic Auth 用户名和密码。")
                .setView(fields)
                .setPositiveButton("登录", (dialog, which) -> {
                    authDialog = null;
                    handler.proceed(username.getText().toString(), password.getText().toString());
                })
                .setNegativeButton("取消", (dialog, which) -> handler.cancel())
                .setOnCancelListener(dialog -> handler.cancel())
                .create();
        authDialog.setOnDismissListener(dialog -> {
            if (authDialog == dialog) {
                authDialog = null;
            }
        });
        authDialog.show();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        webView.saveState(state);
        if (errorPanel.getVisibility() == View.VISIBLE) {
            state.putString("connectionError", errorMessage.getText().toString());
        }
    }

    @Override
    public void onBackPressed() {
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
        if (authDialog != null) {
            authDialog.cancel();
        }
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
            if (authDialog != null || !(HOST.equals(host) || (HOST + ":" + port).equals(host))) {
                handler.cancel();
                return;
            }
            promptForHttpAuth(handler);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            Uri page = Uri.parse(url);
            if (url.equals(view.getUrl()) && errorPanel.getVisibility() == View.GONE && isTavern(page)) {
                if ("/".equals(page.getPath())) {
                    view.evaluateJavascript("location.replace('/app/')", null);
                } else {
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
                showError("SillyTavern 要求认证（HTTP 401）。\n请点重试，并在登录框中输入酒馆的用户名和密码。");
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
