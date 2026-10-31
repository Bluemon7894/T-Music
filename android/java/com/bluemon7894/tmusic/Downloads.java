package com.bluemon7894.tmusic;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// Writes audio files to the app's own storage. The page keeps the list of what's downloaded and
// decides what to fetch; see src/android/downloads.js.
final class Downloads {
    // googlevideo throttles one long request to about playback speed but serves short ranged
    // requests at full speed, so fetch the file in 1 MB pieces.
    private static final int CHUNK = 1024 * 1024;
    private static final long PROGRESS_EVERY_MS = 200;

    private final NativeBridge bridge;
    private final Context context;
    private final Map<String, Thread> running = new ConcurrentHashMap<>();

    Downloads(NativeBridge bridge, Context context) {
        this.bridge = bridge;
        this.context = context;
    }

    private static File folder(Context context) {
        File dir = new File(context.getFilesDir(), "downloads");
        dir.mkdirs();
        return dir;
    }

    static File localFile(Context context, String id) {
        for (String ext : new String[] { ".m4a", ".webm" }) {
            File file = new File(folder(context), id + ext);
            if (file.isFile()) return file;
        }
        return null;
    }

    void start(String id, String url, String mime) {
        if (!id.matches("[\\w-]{11}")) return;
        Thread thread = new Thread(() -> run(id, url, mime), "download-" + id);
        running.put(id, thread);
        thread.start();
    }

    void cancel(String id) {
        Thread thread = running.get(id);
        if (thread != null) thread.interrupt();
    }

    long remove(String id) {
        File file = localFile(context, id);
        if (file == null) return 0;
        long size = file.length();
        return file.delete() ? size : 0;
    }

    private void run(String id, String url, String mime) {
        String ext = mime != null && mime.contains("webm") ? ".webm" : ".m4a";
        File target = new File(folder(context), id + ext);
        File part = new File(folder(context), id + ext + ".part");
        long received = 0;
        long total = 0;
        long lastProgress = 0;
        byte[] buffer = new byte[64 * 1024];
        try (FileOutputStream out = new FileOutputStream(part)) {
            while (total == 0 || received < total) {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("Accept-Encoding", "identity");
                c.setRequestProperty("Range", "bytes=" + received + "-" + (received + CHUNK - 1));
                try {
                    int status = c.getResponseCode();
                    if (status == 403 || status == 410) throw new RejectedException();
                    if (status != 200 && status != 206) throw new IOException("HTTP " + status);
                    if (total == 0) total = totalOf(c);
                    long before = received;
                    try (InputStream in = c.getInputStream()) {
                        int n;
                        while ((n = in.read(buffer)) > 0) {
                            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                            out.write(buffer, 0, n);
                            received += n;
                            long now = System.currentTimeMillis();
                            if (now - lastProgress >= PROGRESS_EVERY_MS) {
                                lastProgress = now;
                                bridge.emit("download", "id", id, "status", "progress", "received", received, "total", total);
                            }
                        }
                    }
                    if (total == 0) break; // the server didn't say how long it is, so this was all of it
                    if (received == before) throw new IOException(Lang.say("다운로드가 중단되었습니다", "The download stopped"));
                } finally {
                    c.disconnect();
                }
            }
            out.flush();
            out.getFD().sync();
        } catch (InterruptedException | java.io.InterruptedIOException e) {
            part.delete();
            running.remove(id);
            bridge.emit("download", "id", id, "status", "cancelled");
            return;
        } catch (RejectedException e) {
            part.delete();
            running.remove(id);
            bridge.emit("download", "id", id, "status", "rejected");
            return;
        } catch (IOException e) {
            part.delete();
            running.remove(id);
            bridge.emit("download", "id", id, "status", "error", "error", String.valueOf(e.getMessage()));
            return;
        }
        running.remove(id);
        if (part.renameTo(target)) {
            bridge.emit("download", "id", id, "status", "done", "size", target.length(), "mime", ext.equals(".webm") ? "audio/webm" : "audio/mp4");
        } else {
            part.delete();
            bridge.emit("download", "id", id, "status", "error", "error", Lang.say("저장하지 못했습니다", "Couldn't save"));
        }
    }

    private static long totalOf(HttpURLConnection c) {
        String range = c.getHeaderField("Content-Range");
        if (range != null && range.contains("/")) {
            try {
                return Long.parseLong(range.substring(range.indexOf('/') + 1).trim());
            } catch (NumberFormatException ignored) {
                // falls through to Content-Length
            }
        }
        return Math.max(0, c.getContentLengthLong());
    }

    // The URL was refused, which usually means it expired. The page gets a new one and starts over.
    private static final class RejectedException extends IOException {
    }
}
