package com.bluemon7894.tmusic;

import android.util.Log;
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
        if (local != null) {
            log(id + " from the downloaded file, " + range);
            return serveFile(local, range);
        }
        if (id.endsWith("Z")) return serveLocalMusic(id, range);

        // Pass the Range request straight upstream so the player can seek anywhere in the file.
        String upstream = range == null ? "bytes=0-" : range;
        // The player asking again means it has let go of what it asked before. Those still waiting for the
        // network hold one of the few threads the page reads with: enough of them and the new request never
        // even starts. One that's flowing is left alone; it may be another player (repeat one preloads the
        // same song), and one that isn't wanted any more is closed by the page anyway.
        for (ResumingStream old : LIVE) if (old.id.equals(id) && old.waiting) old.abandon();
        log(id + " asked " + upstream + (fresh ? " fresh" : ""));

        // A reload asking for a fresh address still gets the one it has when that works: it was fine minutes
        // ago, and getting another means asking the page, which a phone with its screen off has frozen. Only
        // once per retry token, so the seeks of one reload don't each start over.
        boolean wantFresh = false;
        if (fresh) {
            String key = retry != null ? retry : "fresh";
            wantFresh = !key.equals(lastFreshRetry.put(id, key));
        }

        // The player asks again for a track it's already playing whenever it wants more of it, often with the
        // screen off. The address it had is good for hours, so that needs nothing from the page, which a
        // sleeping phone may have frozen.
        Known known = knownAddresses.get(id);
        if (known != null && known.expires > System.currentTimeMillis()) {
            // Answered at once from what the address says about the file, the connection made when the bytes
            // are read, as patiently as a dropped one (see ResumingStream). With the network away the player
            // just waits, rather than taking a failed answer for a song that won't play and skipping it.
            WebResourceResponse answer = answerFromKnown(id, known, upstream);
            if (answer != null) return answer;
            try {
                WebResourceResponse response = open(id, known.address, known.method, upstream);
                if (response != null) return response;
            } catch (IOException e) {
                // asked of the page below
            }
            knownAddresses.remove(id);
            host.bridge.invalidateStream(id, known.method, true);
            report(id, "known address refused");
        } else if (wantFresh) {
            knownAddresses.remove(id);
            host.bridge.invalidateStream(id, "", true);
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
        log(id + " trouble: " + why);
        host.bridge.emit("streamTrouble", "id", id, "why", why);
    }

    private static final Pattern URL_PARAM_CLEN = Pattern.compile("[?&]clen=(\\d+)");
    private static final Pattern URL_PARAM_MIME = Pattern.compile("[?&]mime=([^&]+)");

    // A googlevideo address carries the file's length and type, so the player's request can be answered
    // without the network. Null when it doesn't, or for a range that isn't a plain "from here on".
    static volatile boolean answerAtOnce = true; // test builds can turn it off to compare

    private WebResourceResponse answerFromKnown(String id, Known known, String range) {
        if (!answerAtOnce) return null;
        String url = known.address.optString("url");
        Matcher len = URL_PARAM_CLEN.matcher(url);
        Matcher mime = URL_PARAM_MIME.matcher(url);
        Matcher want = RANGE.matcher(range);
        if (!len.find() || !mime.find() || !want.find() || want.group(1).isEmpty()) return null;
        long size = Long.parseLong(len.group(1));
        long start = Long.parseLong(want.group(1));
        long last = want.group(2).isEmpty() ? size - 1 : Math.min(Long.parseLong(want.group(2)), size - 1);
        if (start >= size || last < start) return null;
        String type;
        try {
            type = java.net.URLDecoder.decode(mime.group(1), "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return null;
        }
        Map<String, String> headers = baseHeaders();
        headers.put("Content-Type", type);
        headers.put("Content-Length", String.valueOf(last - start + 1));
        headers.put("Content-Range", "bytes " + start + "-" + last + "/" + size);
        log(id + " answered from the known address, " + start + "-" + last + "/" + size);
        return new WebResourceResponse(type, null, 206, "Partial Content", headers, new ResumingStream(id, url, known.method, start, last + 1));
    }

    private static final int OPENED = 1;
    private static final int UNREACHABLE = 0;
    private static final int REFUSED = -1;

    // Streams being read right now, so a test build can cut their connections and watch them recover.
    private static final java.util.Set<ResumingStream> LIVE = java.util.concurrent.ConcurrentHashMap.newKeySet();

    static int dropConnectionsForTest() {
        for (ResumingStream s : LIVE) if (s.connection != null) s.connection.disconnect();
        return LIVE.size();
    }

    // Each step of a stream in the phone's own log: it's written even while the page is frozen.
    private static void log(String message) {
        Log.i("TMusicStream", message);
    }

    // The network can go away for a while under music playing with the screen off: a tunnel, a lift,
    // Wi-Fi handing over to mobile data. A dropped connection keeps being opened again, further apart
    // each time, and the music waits and carries on instead of stopping. Only an address YouTube refuses
    // ends that early.
    private static final long OUTAGE_PATIENCE_MS = 10 * 60 * 1000L;
    private static final long[] BACKOFF_MS = { 0, 350, 900, 1800, 3000, 5000, 8000 };
    private static final long BACKOFF_MAX_MS = 10000;
    // Test builds only: every connection fails until then, as with no network.
    private static volatile long outageUntil = 0;

    static void outageForTest(int seconds) {
        outageUntil = System.currentTimeMillis() + seconds * 1000L;
    }

    private static HttpURLConnection connect(String url, String range) throws IOException {
        if (System.currentTimeMillis() < outageUntil) throw new IOException("simulated outage");
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
            InputStream in = afd.createInputStream(); // from the start, as with downloads (see serveFile)
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
            // From the file's start: WebView skips to the range it asked for by itself. Skipped here as well,
            // it saw too little left to skip and gave up on the answer, and a jump past what was loaded stalled.
            FileInputStream in = new FileInputStream(file);
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
        private volatile boolean waiting = false; // reconnecting, for as long as the network is away
        private final Object gate = new Object();

        // Not connected yet: the first read opens it, with the patience of a dropped connection.
        ResumingStream(String id, String url, String method, long start, long end) {
            this.id = id;
            this.url = url;
            this.method = method == null ? "" : method;
            this.position = start;
            this.end = end;
            LIVE.add(this);
        }

        ResumingStream(String id, String url, String method, HttpURLConnection connection, long start, long end) throws IOException {
            this.id = id;
            this.url = url;
            this.method = method == null ? "" : method;
            this.connection = connection;
            this.in = connection.getInputStream();
            this.position = start;
            this.end = end;
            LIVE.add(this);
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n < 0 ? -1 : one[0] & 0xff;
        }

        // WebView skips to the start of the range it asked for by itself, but this stream already starts
        // there (the server was asked for that range). Skipping again would hand the player bytes from twice
        // as far in, which it can't decode: a jump, or a reload that resumes mid-song, then stalls for good.
        @Override
        public long skip(long n) {
            log(id + " skip " + n + " ignored, already at " + position);
            return n;
        }

        @Override
        public int read(byte[] buffer, int offset, int count) throws IOException {
            if (count == 0) return 0;
            while (true) {
                if (end >= 0 && position >= end) return -1;
                IOException failure = null;
                if (in == null) {
                    if (closed || !resume()) throw new IOException("could not connect");
                    continue;
                }
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
                if (!closed) log(id + " dropped at " + position + "/" + end + ": " + (failure != null ? failure.getClass().getSimpleName() + " " + failure.getMessage() : "ended early"));
                if (closed || !resume()) {
                    if (!closed) report(id, failure != null ? "reopen failed after " + failure.getClass().getSimpleName() : "reopen failed after early end");
                    if (failure != null) throw failure;
                    throw new IOException("stream ended early");
                }
            }
        }

        private boolean pauseBeforeRetry(long ms) {
            synchronized (gate) {
                if (closed) return false;
                try {
                    gate.wait(ms);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
                return !closed;
            }
        }

        // No longer wanted: stop waiting and free the thread reading it.
        void abandon() {
            if (closed) return;
            log(id + " let go from " + position);
            closed = true;
            LIVE.remove(this);
            synchronized (gate) {
                gate.notifyAll();
            }
            HttpURLConnection c = connection;
            if (c != null) c.disconnect();
        }

        private boolean resume() {
            waiting = true;
            try {
                return reconnect();
            } finally {
                waiting = false;
            }
        }

        private boolean reconnect() {
            disconnect();
            // The same address, for as long as the network is away (see OUTAGE_PATIENCE_MS).
            if (url != null && !url.isEmpty()) {
                long started = System.currentTimeMillis();
                for (int attempt = 0; !closed; attempt++) {
                    long waitMs = attempt < BACKOFF_MS.length ? BACKOFF_MS[attempt] : BACKOFF_MAX_MS;
                    if (waitMs > 0 && !pauseBeforeRetry(waitMs)) return false;
                    int outcome = reopen(url);
                    if (outcome == OPENED) {
                        if (attempt > 0) log(id + " back after " + (System.currentTimeMillis() - started) / 1000 + "s, " + (attempt + 1) + " tries");
                        return true;
                    }
                    if (outcome == REFUSED || System.currentTimeMillis() - started > OUTAGE_PATIENCE_MS) break;
                }
                if (closed) return false;
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
                if (reopen(nextUrl) == OPENED) {
                    url = nextUrl;
                    method = nextMethod;
                    remember(id, nextUrl, nextMethod);
                    return true;
                }
                host.bridge.invalidateStream(id, nextMethod, resolved.optBoolean("fresh"));
            }
            return false;
        }

        // OPENED, UNREACHABLE (no answer: the network) or REFUSED (YouTube answered no).
        private int reopen(String address) {
            try {
                String range = "bytes=" + position + "-" + (end >= 0 ? String.valueOf(end - 1) : "");
                HttpURLConnection c = connect(address, range);
                int status = c.getResponseCode();
                log(id + " reopen from " + position + " -> " + status);
                if (status == 206 || (position == 0 && status == 200)) {
                    connection = c;
                    in = c.getInputStream();
                    return OPENED;
                }
                c.disconnect();
                return REFUSED;
            } catch (IOException e) {
                log(id + " reopen from " + position + " failed: " + e.getClass().getSimpleName() + " " + e.getMessage());
                return UNREACHABLE;
            }
        }

        private void disconnect() {
            try {
                if (in != null) in.close();
            } catch (IOException ignored) {
                // already gone
            }
            if (connection != null) connection.disconnect();
            in = null;
            connection = null;
        }

        @Override
        public void close() {
            closed = true;
            LIVE.remove(this);
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
