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
    private static final Pattern CONTENT_RANGE = Pattern.compile("bytes (\\d+)-(\\d+)/");
    private static final Pattern EXPIRE = Pattern.compile("[?&]expire=(\\d+)");
    private static final int ATTEMPTS = 3;
    // Times one response may pick itself up again after its connection drops (see ResumingStream).
    private static final int RESUMES = 8;

    private final WebHost host;
    private final Map<String, String> lastFreshRetry = new java.util.concurrent.ConcurrentHashMap<>();

    StreamHandler(WebHost host) {
        this.host = host;
    }

    WebResourceResponse serve(String id, Map<String, String> requestHeaders) {
        return serve(id, requestHeaders, false, null);
    }

    WebResourceResponse serve(String id, Map<String, String> requestHeaders, boolean fresh, String retry) {
        if (!id.matches("[\\w-]{11}")) return failure(400, "Bad Request");
        String range = headerOf(requestHeaders, "Range");

        File local = Downloads.localFile(host.app, id);
        if (local != null) return serveFile(local, range);
        if (id.endsWith("Z")) return serveLocalMusic(id, range);

        // Pass the Range request straight upstream so the player can seek anywhere in the file.
        String upstream = range == null ? "bytes=0-" : range;

        // Only invalidate once per retry token so subsequent Range seeks during the same retry reuse the fresh URL.
        if (fresh) {
            String key = retry != null ? retry : "fresh";
            String prev = lastFreshRetry.put(id, key);
            if (!key.equals(prev)) {
                Known dropped = knownAddresses.remove(id);
                host.bridge.invalidateStream(id, dropped != null ? dropped.method : "", true);
            }
        }

        // The player asks again for a track it's already playing whenever it wants more of it, often with the
        // screen off. The address it had is good for hours, so that needs nothing from the page, which a
        // sleeping phone may have frozen.
        Known known = knownAddresses.get(id);
        if (known != null && known.expires > System.currentTimeMillis()) {
            try {
                WebResourceResponse response = open(id, known.address, known.method, upstream);
                if (response != null) return response;
            } catch (IOException e) {
                // asked of the page below
            }
            knownAddresses.remove(id);
            host.bridge.invalidateStream(id, known.method, true);
            report(id, "known address refused");
        }

        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            host.wakeBriefly();
            JSONObject resolved = host.bridge.resolveStream(id);
            if (resolved == null || resolved.optString("url").isEmpty()) {
                report(id, resolved == null ? "page did not answer" : "no address");
                return failure(502, "Bad Gateway");
            }
            String method = resolved.optString("method");
            try {
                WebResourceResponse response = open(id, resolved, method, upstream);
                if (response != null) {
                    remember(id, resolved.optString("url"), method);
                    return response;
                }
            } catch (IOException e) {
                // a network error is treated like a rejected URL
            }
            // A cached URL may simply have expired: drop it and resolve a fresh one.
            host.bridge.invalidateStream(id, method, resolved.optBoolean("fresh"));
        }
        report(id, "every address refused");
        return failure(502, "Bad Gateway");
    }

    private static final class Known {
        final JSONObject address;
        final String method;
        final long expires;

        Known(JSONObject address, String method, long expires) {
            this.address = address;
            this.method = method;
            this.expires = expires;
        }
    }

    private static final int KNOWN_LIMIT = 30;
    private final Map<String, Known> knownAddresses = new java.util.concurrent.ConcurrentHashMap<>();

    // Until ten minutes before the address says it stops working, or an hour if it doesn't say.
    private void remember(String id, String url, String method) {
        long expires = System.currentTimeMillis() + 60 * 60 * 1000L;
        Matcher m = EXPIRE.matcher(url);
        if (m.find()) expires = Long.parseLong(m.group(1)) * 1000L - 10 * 60 * 1000L;
        if (knownAddresses.size() > KNOWN_LIMIT) knownAddresses.clear();
        try {
            knownAddresses.put(id, new Known(new JSONObject().put("url", url), method, expires));
        } catch (org.json.JSONException ignored) {
            // a plain string always fits
        }
    }

    // Why a stream failed goes to the page's trouble notes, which reach the developer.
    private void report(String id, String why) {
        host.bridge.emit("streamTrouble", "id", id, "why", why);
    }

    private static HttpURLConnection connect(String url, String range) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Range", range);
        c.setRequestProperty("Accept-Encoding", "identity");
        return c;
    }

    private WebResourceResponse open(String id, JSONObject resolved, String method, String range) throws IOException {
        HttpURLConnection c = connect(resolved.optString("url"), range);
        int status = c.getResponseCode();
        if (status == 200 || status == 206) {
            Map<String, String> headers = baseHeaders();
            copyHeader(c, headers, "Content-Length");
            copyHeader(c, headers, "Content-Range");
            String type = c.getHeaderField("Content-Type");
            String mime = type == null ? "audio/mp4" : type.split(";")[0].trim();
            headers.put("Content-Type", type == null ? mime : type);
            // Where this response's bytes start and end, so a dropped connection can carry on from the
            // byte it stopped at.
            long start = 0;
            long end = -1;
            String contentRange = c.getHeaderField("Content-Range");
            Matcher m = CONTENT_RANGE.matcher(contentRange == null ? "" : contentRange);
            if (status == 206 && m.find()) {
                start = Long.parseLong(m.group(1));
                end = Long.parseLong(m.group(2)) + 1;
            } else if (status == 200 && c.getContentLengthLong() >= 0) {
                end = c.getContentLengthLong();
            }
            InputStream body = new ResumingStream(id, resolved.optString("url"), method, c, start, end);
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

    // A file from the phone's own music library, read through the system with the same byte ranges.
    private WebResourceResponse serveLocalMusic(String id, String range) {
        android.content.res.AssetFileDescriptor afd = LocalMusic.open(host.app, id);
        if (afd == null) return failure(404, "Not Found");
        String mime = LocalMusic.mimeOf(host.app, id);
        long size = afd.getLength();
        Map<String, String> headers = baseHeaders();
        headers.put("Content-Type", mime);
        long start = 0;
        long end = size - 1;
        boolean partial = false;
        if (range != null && size > 0) {
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
        try {
            if (partial && start >= size) {
                afd.close();
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
            }
            InputStream in = afd.createInputStream();
            long skipped = 0;
            while (skipped < start) {
                long n = in.skip(start - skipped);
                if (n <= 0) break;
                skipped += n;
            }
            if (size < 0) return new WebResourceResponse(mime, null, 200, "OK", headers, in);
            long length = end - start + 1;
            headers.put("Content-Length", String.valueOf(length));
            if (partial) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", headers, new LimitedStream(in, length));
        } catch (IOException e) {
            return failure(500, "Server Error");
        }
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

    // The player reads a track as far ahead as it wants and then stops reading for a while. A paused track
    // can sit like that for minutes, and the server closes the idle connection: the next read fails and
    // <audio> gives up on the whole track. Instead, a dropped connection is opened again from the byte it
    // stopped at, with a freshly resolved address if need be, and the player never notices.
    private final class ResumingStream extends InputStream {
        private final String id;
        private String url;
        private String method;
        private HttpURLConnection connection;
        private InputStream in;
        private long position;
        private final long end; // one past the last byte, or -1 when unknown
        private int resumes = 0;
        private volatile boolean closed = false;

        ResumingStream(String id, String url, String method, HttpURLConnection connection, long start, long end) throws IOException {
            this.id = id;
            this.url = url;
            this.method = method == null ? "" : method;
            this.connection = connection;
            this.in = connection.getInputStream();
            this.position = start;
            this.end = end;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int offset, int count) throws IOException {
            if (count == 0) return 0;
            while (true) {
                if (end >= 0 && position >= end) return -1;
                IOException failure = null;
                try {
                    int n = in.read(buffer, offset, count);
                    if (n > 0) {
                        position += n;
                        return n;
                    }
                    if (n < 0 && end < 0) return -1; // no length to check against: take the end as real
                } catch (IOException e) {
                    failure = e;
                }
                if (closed || !resume()) {
                    if (!closed) report(id, failure != null ? "reopen failed after " + failure.getClass().getSimpleName() : "reopen failed after early end");
                    if (failure != null) throw failure;
                    throw new IOException("stream ended early");
                }
            }
        }

        private boolean pauseBeforeRetry(long ms) {
            try {
                Thread.sleep(ms);
                return !closed;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }

        private boolean resume() {
            disconnect();
            // Brief mobile handoffs (Wi-Fi <-> LTE, cell switching) fail once immediately; retry the same URL with backoff.
            if (url != null && !url.isEmpty()) {
                for (long waitMs : new long[] { 0, 350, 900, 1800 }) {
                    if (closed) return false;
                    if (waitMs > 0 && !pauseBeforeRetry(waitMs)) return false;
                    if (reopen(url)) return true;
                }
            }
            // Only resolve a new URL mid-stream when at byte 0; stitching bytes from a different URL/format
            // after an MP4 header breaks FFmpegAudioDecoder. Let the player reload cleanly from the header instead.
            knownAddresses.remove(id);
            host.bridge.invalidateStream(id, method, true);
            if (position > 0) return false;
            while (resumes < RESUMES && !closed) {
                resumes++;
                if (resumes > 1 && !pauseBeforeRetry(Math.min(1500, resumes * 300L))) return false;
                host.wakeBriefly();
                JSONObject resolved = host.bridge.resolveStream(id);
                if (resolved == null || resolved.optString("url").isEmpty()) continue;
                String nextUrl = resolved.optString("url");
                String nextMethod = resolved.optString("method");
                if (reopen(nextUrl)) {
                    url = nextUrl;
                    method = nextMethod;
                    remember(id, nextUrl, nextMethod);
                    return true;
                }
                host.bridge.invalidateStream(id, nextMethod, resolved.optBoolean("fresh"));
            }
            return false;
        }

        private boolean reopen(String address) {
            try {
                String range = "bytes=" + position + "-" + (end >= 0 ? String.valueOf(end - 1) : "");
                HttpURLConnection c = connect(address, range);
                int status = c.getResponseCode();
                if (status == 206 || (position == 0 && status == 200)) {
                    connection = c;
                    in = c.getInputStream();
                    return true;
                }
                c.disconnect();
            } catch (IOException e) {
                // transient failure or stale address
            }
            return false;
        }

        private void disconnect() {
            try {
                in.close();
            } catch (IOException ignored) {
                // already gone
            }
            connection.disconnect();
        }

        @Override
        public void close() {
            closed = true;
            disconnect();
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
