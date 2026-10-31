package com.bluemon7894.tmusic;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.MutableContextWrapper;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

// Owns the page for as long as the process lives. The window comes and goes around it.
final class WebHost {
    static final String ORIGIN_HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + ORIGIN_HOST;

    private static WebHost instance;

    final Context app;
    final NativeBridge bridge;
    final Handler main = new Handler(Looper.getMainLooper());

    private final MutableContextWrapper context;
    private WebView web;
    private MainActivity activity;
    private ViewGroup parent;
    private float insetTop;
    private float insetBottom;

    static synchronized WebHost get(Context context) {
        if (instance == null) instance = new WebHost(context.getApplicationContext());
        return instance;
    }

    private WebHost(Context app) {
        this.app = app;
        context = new MutableContextWrapper(app);
        bridge = new NativeBridge(this);
        web = createWebView();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView view = new AppWebView(context);
        view.setBackgroundColor(0xff0a0712);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        view.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        view.setVerticalScrollBarEnabled(false);
        view.setHorizontalScrollBarEnabled(false);
        // Keeps the page's process from being cut off while music plays with the screen off.
        view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        view.setWebViewClient(new AppWebClient(this));
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
                MainActivity a = activity;
                return a != null && a.showFileChooser(callback, params);
            }
        });
        view.addJavascriptInterface(bridge, "TMusicNative");
        view.loadUrl(ORIGIN + "/index.html");
        return view;
    }

    void attach(MainActivity next, ViewGroup into) {
        activity = next;
        parent = into;
        context.setBaseContext(next);
        ViewGroup old = (ViewGroup) web.getParent();
        if (old != null) old.removeView(web);
        into.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        into.requestApplyInsets();
    }

    void detach(MainActivity leaving) {
        if (activity != leaving) return;
        activity = null;
        parent = null;
        ViewGroup old = (ViewGroup) web.getParent();
        if (old != null) old.removeView(web);
        context.setBaseContext(app);
    }

    MainActivity activity() {
        return activity;
    }

    // The page's process died, usually for lack of memory. Start the page again rather than the app.
    void recreateWebView() {
        WebView dead = web;
        ViewGroup into = parent;
        if (into != null) into.removeView(dead);
        dead.destroy();
        web = createWebView();
        if (into != null) {
            into.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
    }

    void evaluate(String script) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript(script, null);
        });
    }

    void setInsets(float top, float bottom, boolean keyboard) {
        insetTop = top;
        insetBottom = bottom;
        bridge.emit("insets", "top", top, "bottom", bottom, "keyboard", keyboard);
    }

    float insetTop() {
        return insetTop;
    }

    float insetBottom() {
        return insetBottom;
    }
}
