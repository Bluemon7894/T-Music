package com.bluemon7894.tmusic;

import android.content.Intent;
import android.net.Uri;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

// Every request for the app's own address is answered from here, so no port is ever opened that
// another app on the phone could reach. /stream/ID is what <audio> plays, /__proxy/TOKEN carries
// requests the page isn't allowed to make itself, and everything else is the page's own files.
final class AppWebClient extends WebViewClient {
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("png", "image/png");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("ico", "image/x-icon");
    }

    private final WebHost host;
    private final StreamHandler streams;

    AppWebClient(WebHost host) {
        this.host = host;
        streams = new StreamHandler(host);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!WebHost.ORIGIN_HOST.equals(url.getHost())) return null;
        String path = url.getPath() == null ? "/" : url.getPath();
        if (path.startsWith("/stream/")) return streams.serve(path.substring("/stream/".length()), request.getRequestHeaders());
        if (path.startsWith("/__proxy/")) return host.bridge.proxy.serve(path.substring("/__proxy/".length()));
        return asset(path);
    }

    private WebResourceResponse asset(String path) {
        String clean = "/".equals(path) ? "/index.html" : path;
        if (clean.contains("..")) return empty(404, "Not Found");
        try {
            InputStream in = host.app.getAssets().open("www" + clean);
            int dot = clean.lastIndexOf('.');
            String mime = MIME.get(dot < 0 ? "" : clean.substring(dot + 1).toLowerCase());
            return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", in);
        } catch (IOException e) {
            return empty(404, "Not Found");
        }
    }

    private static WebResourceResponse empty(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    // A link must never replace the app with another page, which would get its native functions.
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (WebHost.ORIGIN_HOST.equals(url.getHost())) return false;
        if (!request.isForMainFrame()) return false;
        if ("https".equals(url.getScheme()) || "http".equals(url.getScheme())) {
            Intent intent = new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                host.app.startActivity(intent);
            } catch (Exception ignored) {
                // no browser on this phone
            }
        }
        return true;
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        host.main.post(host::recreateWebView);
        return true;
    }
}
