package com.bluemon7894.tmusic;

import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// /stream/VIDEO_ID, the Android counterpart of electron/protocol.js. Downloaded tracks come from
// disk; everything else is resolved by the page to a googlevideo URL and piped through, so URL
// expiry and client fallback stay invisible to <audio>.
final class StreamHandler {
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
    private static final int ATTEMPTS = 3;

    private final WebHost host;

    StreamHandler(WebHost host) {
        this.host = host;
    }

    WebResourceResponse serve(String id, Map<String, String> requestHeaders) {
        if (!id.matches("[\\w-]{11}")) return failure(400, "Bad Request");
        String range = headerOf(requestHeaders, "Range");

        File local = Downloads.localFile(host.app, id);
        if (local != null) return serveFile(local, range);

        // Pass the Range request straight upstream so the player can seek anywhere in the file.
        String upstream = range == null ? "bytes=0-" : range;
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            JSONObject resolved = host.bridge.resolveStream(id);
            if (resolved == null || resolved.optString("url").isEmpty()) return failure(502, "Bad Gateway");
            try {
                WebResourceResponse response = open(resolved, upstream);
                if (response != null) return response;
            } catch (IOException e) {
                // a network error is treated like a rejected URL
            }
            // A cached URL may simply have expired: drop it and resolve a fresh one.
            host.bridge.invalidateStream(id, resolved.optString("method"), resolved.optBoolean("fresh"));
        }
        return failure(502, "Bad Gateway");
    }

    private WebResourceResponse open(JSONObject resolved, String range) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(resolved.optString("url")).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Range", range);
        c.setRequestProperty("Accept-Encoding", "identity");
        int status = c.getResponseCode();
        if (status == 200 || status == 206) {
            Map<String, String> headers = baseHeaders();
            copyHeader(c, headers, "Content-Length");
            copyHeader(c, headers, "Content-Range");
            String type = c.getHeaderField("Content-Type");
            String mime = type == null ? "audio/mp4" : type.split(";")[0].trim();
            headers.put("Content-Type", type == null ? mime : type);
            InputStream body = new ClosingStream(c.getInputStream(), c);
            return new WebResourceResponse(mime, null, status, status == 206 ? "Partial Content" : "OK", headers, body);
        }
        if (status == 416) {
            Map<String, String> headers = baseHeaders();
            copyHeader(c, headers, "Content-Range");
            c.disconnect();
            return new WebResourceResponse("audio/mp4", null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
        }
        c.disconnect();
        return null;
    }

    private WebResourceResponse serveFile(File file, String range) {
        long size = file.length();
        String mime = file.getName().endsWith(".webm") ? "audio/webm" : "audio/mp4";
        Map<String, String> headers = baseHeaders();
        headers.put("Content-Type", mime);
        long start = 0;
        long end = size - 1;
        boolean partial = false;
        if (range != null) {
            Matcher m = RANGE.matcher(range);
            if (m.find() && !(m.group(1).isEmpty() && m.group(2).isEmpty())) {
                partial = true;
                if (m.group(1).isEmpty()) {
                    start = Math.max(0, size - Long.parseLong(m.group(2)));
                } else {
                    start = Long.parseLong(m.group(1));
                    if (!m.group(2).isEmpty()) end = Math.min(Long.parseLong(m.group(2)), size - 1);
                }
            }
        }
        if (partial && start >= size) {
            headers.put("Content-Range", "bytes */" + size);
            return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
        }
        long length = end - start + 1;
        headers.put("Content-Length", String.valueOf(length));
        if (partial) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        try {
            FileInputStream in = new FileInputStream(file);
            long skipped = 0;
            while (skipped < start) {
                long n = in.skip(start - skipped);
                if (n <= 0) break;
                skipped += n;
            }
            return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", headers, new LimitedStream(in, length));
        } catch (IOException e) {
            return failure(500, "Server Error");
        }
    }

    private static Map<String, String> baseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Accept-Ranges", "bytes");
        return headers;
    }

    private static void copyHeader(HttpURLConnection c, Map<String, String> to, String name) {
        String value = c.getHeaderField(name);
        if (value != null) to.put(name, value);
    }

    static String headerOf(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (name.equalsIgnoreCase(e.getKey())) return e.getValue();
        }
        return null;
    }

    private static WebResourceResponse failure(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, baseHeaders(), new ByteArrayInputStream(new byte[0]));
    }

    private static final class ClosingStream extends FilterInputStream {
        private final HttpURLConnection connection;

        ClosingStream(InputStream in, HttpURLConnection connection) {
            super(in);
            this.connection = connection;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                connection.disconnect();
            }
        }
    }

    private static final class LimitedStream extends FilterInputStream {
        private long left;

        LimitedStream(InputStream in, long length) {
            super(in);
            left = length;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int count) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buffer, offset, (int) Math.min(count, left));
            if (n > 0) left -= n;
            return n;
        }
    }
}
