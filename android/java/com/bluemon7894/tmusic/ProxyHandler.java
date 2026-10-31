package com.bluemon7894.tmusic;

import android.webkit.WebResourceResponse;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

// Makes the requests a web page can't: to other sites, with their own headers. The page registers a
// request and then fetches /__proxy/TOKEN, which gives it a normal streaming response. Only the
// sites the app actually talks to are allowed.
final class ProxyHandler {
    private static final Pattern ALLOWED = Pattern.compile(
        "(.+\\.)?(youtube\\.com|googlevideo\\.com|ytimg\\.com|lrclib\\.net|music\\.163\\.com|qq\\.com|kugou\\.com|naver\\.com"
            + "|api\\.github\\.com|github\\.com|githubusercontent\\.com|oauth2\\.googleapis\\.com|translate\\.googleapis\\.com)");
    private static final String[] SKIPPED_REQUEST_HEADERS = { "host", "content-length", "connection", "accept-encoding" };

    private final Map<String, JSONObject> pending = new ConcurrentHashMap<>();

    String prepare(String json) {
        try {
            JSONObject request = new JSONObject(json);
            String token = UUID.randomUUID().toString();
            pending.put(token, request);
            return token;
        } catch (JSONException e) {
            return "";
        }
    }

    WebResourceResponse serve(String token) {
        JSONObject request = pending.remove(token);
        if (request == null) return failure();
        HttpURLConnection c = null;
        try {
            URL url = new URL(request.getString("url"));
            if (!"https".equals(url.getProtocol()) || !ALLOWED.matcher(url.getHost().toLowerCase(Locale.ROOT)).matches()) return failure();
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            String method = request.optString("method", "GET");
            c.setRequestMethod(method);
            JSONObject headers = request.optJSONObject("headers");
            if (headers != null) {
                for (Iterator<String> names = headers.keys(); names.hasNext(); ) {
                    String name = names.next();
                    if (!skipped(name)) c.setRequestProperty(name, headers.getString(name));
                }
            }
            if (request.has("body") && !request.isNull("body") && !"GET".equals(method)) {
                byte[] body = request.getString("body").getBytes("UTF-8");
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = c.getResponseCode();
            if (status >= 300 && status < 400) status = 502; // redirects were already followed; a response can't carry one
            InputStream body = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);
            Map<String, String> out = new HashMap<>();
            String type = c.getContentType();
            String mime = "application/octet-stream";
            String charset = null;
            if (type != null) {
                out.put("Content-Type", type);
                mime = type.split(";")[0].trim();
                int at = type.toLowerCase(Locale.ROOT).indexOf("charset=");
                if (at >= 0) charset = type.substring(at + 8).replace("\"", "").trim();
            }
            String range = c.getHeaderField("Content-Range");
            if (range != null) out.put("Content-Range", range);
            String reason = c.getResponseMessage();
            return new WebResourceResponse(mime, charset, status, reason == null || reason.isEmpty() ? "OK" : reason, out, body);
        } catch (JSONException | IOException | RuntimeException e) {
            if (c != null) c.disconnect();
            return failure();
        }
    }

    private static boolean skipped(String header) {
        for (String name : SKIPPED_REQUEST_HEADERS) {
            if (name.equalsIgnoreCase(header)) return true;
        }
        return false;
    }

    // The page turns this into the same error fetch gives when there's no connection.
    private static WebResourceResponse failure() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Proxy-Error", "1");
        return new WebResourceResponse("text/plain", "UTF-8", 502, "Bad Gateway", headers, new ByteArrayInputStream(new byte[0]));
    }
}
