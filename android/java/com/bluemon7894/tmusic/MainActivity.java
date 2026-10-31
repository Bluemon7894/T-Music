package com.bluemon7894.tmusic;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.OutputStream;

// The window that shows the app. The page itself lives in WebHost, so that music keeps going after
// the window is closed and the page comes back as it was when the window reopens.
public class MainActivity extends Activity {
    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_SAVE = 2;
    private static final int REQUEST_NOTIFICATIONS = 3;
    // The page uses browser features from this version on. Phones get WebView updates from the Play Store.
    private static final int MIN_WEBVIEW_VERSION = 105;

    private FrameLayout root;
    private boolean started;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);

        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(0xff0a0712);
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> applyInsets(insets));

        if (webViewTooOld()) {
            askToUpdateWebView();
            return;
        }
        started = true;
        WebHost.get(this).attach(this, root);
        handleIntent(getIntent());
        askForNotifications();
    }

    private boolean webViewTooOld() {
        PackageInfo webView = WebView.getCurrentWebViewPackage();
        if (webView == null || webView.versionName == null) return false;
        try {
            return Integer.parseInt(webView.versionName.split("\\.")[0]) < MIN_WEBVIEW_VERSION;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private void askToUpdateWebView() {
        String provider = WebView.getCurrentWebViewPackage().packageName;
        new AlertDialog.Builder(this)
            .setTitle("Android 시스템 WebView를 업데이트해 주세요")
            .setMessage("T-Music은 WebView " + MIN_WEBVIEW_VERSION + " 이상에서 실행됩니다. Play 스토어에서 업데이트한 뒤 다시 열어 주세요.")
            .setCancelable(false)
            .setPositiveButton("Play 스토어 열기", (dialog, which) -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + provider)));
                } catch (Exception e) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + provider)));
                }
                finish();
            })
            .setNegativeButton("닫기", (dialog, which) -> finish())
            .show();
    }

    private WindowInsets applyInsets(WindowInsets insets) {
        float density = getResources().getDisplayMetrics().density;
        int top;
        int bottom;
        int keyboard = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
            top = bars.top;
            bottom = keyboard > 0 ? 0 : bars.bottom;
        } else {
            top = insets.getSystemWindowInsetTop();
            bottom = insets.getSystemWindowInsetBottom();
            // Below Android 11 the keyboard is counted in the bottom inset and already resizes the window.
            if (bottom > 200 * density) {
                keyboard = -1;
                bottom = 0;
            }
        }
        root.setPadding(0, 0, 0, Math.max(0, keyboard));
        if (started) WebHost.get(this).setInsets(top / density, bottom / density, keyboard != 0);
        return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
    }

    private void askForNotifications() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_NOTIFICATIONS);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (started) handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        WebHost host = WebHost.get(this);
        String notification = intent.getStringExtra(NativeBridge.EXTRA_NOTIFICATION);
        if (notification != null) {
            intent.removeExtra(NativeBridge.EXTRA_NOTIFICATION);
            host.bridge.emit("notificationClick", "id", notification);
        }
        Uri data = intent.getData();
        if (data != null) {
            host.bridge.receiveLink(data.toString());
            intent.setData(null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (started) WebHost.get(this).bridge.emit("visibility", "visible", true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (started) WebHost.get(this).bridge.emit("visibility", "visible", false);
    }

    @Override
    public void onBackPressed() {
        if (started) WebHost.get(this).bridge.emit("back");
        else finish();
    }

    @Override
    protected void onDestroy() {
        if (started) WebHost.get(this).detach(this);
        super.onDestroy();
    }

    // ---- file picker for <input type=file>, used to restore a library backup ----

    boolean showFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try {
            startActivityForResult(params.createIntent(), REQUEST_FILE);
            return true;
        } catch (Exception e) {
            fileCallback = null;
            return false;
        }
    }

    // ---- writing a library backup where the user chooses ----

    void saveDocument(String name, String mime, String content) {
        pendingSave = content;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(intent, REQUEST_SAVE);
        } catch (Exception e) {
            pendingSave = null;
            WebHost.get(this).bridge.emit("saved", "ok", false);
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQUEST_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (request == REQUEST_SAVE) {
            boolean ok = false;
            if (result == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    out.write(pendingSave.getBytes("UTF-8"));
                    ok = true;
                } catch (Exception ignored) {
                    // reported as not saved below
                }
            }
            pendingSave = null;
            WebHost.get(this).bridge.emit("saved", "ok", ok);
        }
    }
}
