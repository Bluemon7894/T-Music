package com.bluemon7894.tmusic;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Fetches a new APK and hands it to the system installer, which refuses it unless it's signed with
// the same key as the installed app.
final class AppUpdater {
    private final NativeBridge bridge;
    private final Context context;

    AppUpdater(NativeBridge bridge, Context context) {
        this.bridge = bridge;
        this.context = context;
    }

    static File apkFile(Context context) {
        File dir = new File(context.getCacheDir(), "update");
        dir.mkdirs();
        return new File(dir, "T-Music.apk");
    }

    void download(String url) {
        Thread thread = new Thread(() -> run(url), "app-update");
        thread.start();
    }

    private void run(String url) {
        File target = apkFile(context);
        File part = new File(target.getPath() + ".part");
        byte[] buffer = new byte[64 * 1024];
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(true);
            int status = c.getResponseCode();
            if (status != 200) throw new IOException("HTTP " + status);
            long total = Math.max(0, c.getContentLengthLong());
            long received = 0;
            long last = 0;
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                    received += n;
                    long now = System.currentTimeMillis();
                    if (now - last >= 200) {
                        last = now;
                        bridge.emit("update", "status", "downloading", "received", received, "total", total, "percent", total > 0 ? (int) (received * 100 / total) : 0);
                    }
                }
            } finally {
                c.disconnect();
            }
            if (total > 0 && received != total) throw new IOException(Lang.say("다운로드가 중간에 끊겼습니다", "The download was cut off"));
            if (!part.renameTo(target)) throw new IOException(Lang.say("저장하지 못했습니다", "Couldn't save"));
            bridge.emit("update", "status", "completed", "total", received);
        } catch (IOException e) {
            part.delete();
            bridge.emit("update", "status", "error", "error", String.valueOf(e.getMessage()));
        }
    }

    void install() {
        Uri uri = Uri.parse("content://" + ApkProvider.AUTHORITY + "/T-Music.apk");
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        bridge.startActivity(intent);
    }
}
