package com.bluemon7894.tmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

// Everything the page can ask of the phone, as window.TMusicNative. Answers that take time come back
// as events through window.__tm.onNative.
final class NativeBridge {
    static final String EXTRA_NOTIFICATION = "tmusic.notification";
    private static final String SOCIAL_CHANNEL = "social";

    final ProxyHandler proxy = new ProxyHandler();

    private final WebHost host;
    private final Context app;
    private final Downloads downloads;
    private final AppUpdater updater;
    private final AuthServer auth;
    private final AtomicInteger nextRequest = new AtomicInteger(1);
    private final Map<Integer, Waiting> waiting = new ConcurrentHashMap<>();
    private volatile String pendingLink;

    private static final class Waiting {
        final CountDownLatch done = new CountDownLatch(1);
        volatile JSONObject value;
    }

    NativeBridge(WebHost host) {
        this.host = host;
        app = host.app;
        downloads = new Downloads(this, app);
        updater = new AppUpdater(this, app);
        auth = new AuthServer(this);
    }

    // ---- events to the page ----

    void emit(String type, Object... fields) {
        try {
            JSONObject event = new JSONObject().put("type", type);
            for (int i = 0; i + 1 < fields.length; i += 2) event.put((String) fields[i], fields[i + 1]);
            host.evaluate("window.__tm&&window.__tm.onNative(" + event + ")");
        } catch (JSONException ignored) {
            // field names are constants and values are simple
        }
    }

    // ---- streams: the page knows how to turn a video id into a URL ----

    JSONObject resolveStream(String id) {
        int request = nextRequest.getAndIncrement();
        Waiting wait = new Waiting();
        waiting.put(request, wait);
        host.evaluate("window.__tm&&window.__tm.resolveStream('" + id + "'," + request + ")");
        try {
            wait.done.await(25, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        waiting.remove(request);
        return wait.value;
    }

    void invalidateStream(String id, String method, boolean fresh) {
        host.evaluate("window.__tm&&window.__tm.invalidateStream('" + id + "'," + JSONObject.quote(method) + "," + fresh + ")");
    }

    @JavascriptInterface
    public void streamResolved(int request, String json) {
        Waiting wait = waiting.get(request);
        if (wait == null) return;
        try {
            if (json != null) wait.value = new JSONObject(json);
        } catch (JSONException ignored) {
            // treated as a failed stream
        }
        wait.done.countDown();
    }

    // ---- requests to other sites ----

    @JavascriptInterface
    public String proxyPrepare(String json) {
        return proxy.prepare(json);
    }

    // ---- app information ----

    @JavascriptInterface
    public String appInfo() {
        try {
            PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            return new JSONObject()
                .put("version", info.versionName)
                .put("insetTop", host.insetTop())
                .put("insetBottom", host.insetBottom())
                .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // ---- small files for the page (lyrics cache, indexes), kept inside the app's own storage ----

    private File fileOf(String path) throws IOException {
        File root = app.getFilesDir().getCanonicalFile();
        File file = new File(root, path).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("outside app storage");
        return file;
    }

    @JavascriptInterface
    public String fsRead(String path) {
        try (FileInputStream in = new FileInputStream(fileOf(path))) {
            byte[] data = new byte[in.available()];
            int read = 0;
            while (read < data.length) {
                int n = in.read(data, read, data.length - read);
                if (n < 0) break;
                read += n;
            }
            return new String(data, 0, read, "UTF-8");
        } catch (IOException e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean fsWrite(String path, String content) {
        try {
            File file = fileOf(path);
            file.getParentFile().mkdirs();
            File part = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(part)) {
                out.write(content.getBytes("UTF-8"));
            }
            return part.renameTo(file);
        } catch (IOException e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean fsExists(String path) {
        try {
            return fileOf(path).exists();
        } catch (IOException e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean fsDelete(String path) {
        try {
            return fileOf(path).delete();
        } catch (IOException e) {
            return false;
        }
    }

    // ---- playback controls in the notification and on the lock screen ----

    @JavascriptInterface
    public void playbackState(String json) {
        host.main.post(() -> PlaybackService.update(host, json));
    }

    // ---- downloads ----

    @JavascriptInterface
    public void downloadStart(String id, String url, String mime) {
        downloads.start(id, url, mime);
    }

    @JavascriptInterface
    public void downloadCancel(String id) {
        downloads.cancel(id);
    }

    @JavascriptInterface
    public long downloadRemove(String id) {
        return downloads.remove(id);
    }

    @JavascriptInterface
    public long downloadSize(String id) {
        File file = Downloads.localFile(app, id);
        return file == null ? -1 : file.length();
    }

    // ---- app updates ----

    @JavascriptInterface
    public void updateDownload(String url) {
        updater.download(url);
    }

    @JavascriptInterface
    public void updateInstall() {
        updater.install();
    }

    // ---- Google sign-in ----

    @JavascriptInterface
    public int authListen(String state) {
        return auth.listen(state);
    }

    @JavascriptInterface
    public void authCancel() {
        auth.cancel();
    }

    // ---- links in and out ----

    void receiveLink(String link) {
        if (link.startsWith("tmusic://join/") || link.startsWith("tmusic://playlist/")) {
            pendingLink = link;
            emit("invite");
        }
    }

    @JavascriptInterface
    public String takeLink() {
        String link = pendingLink;
        pendingLink = null;
        return link;
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (url == null || !url.matches("(?i)^https?://.*")) return;
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    @JavascriptInterface
    public void share(String text) {
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        startActivity(Intent.createChooser(send, "공유"));
    }

    void startActivity(Intent intent) {
        try {
            MainActivity activity = host.activity();
            if (activity != null) activity.startActivity(intent);
            else app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {
            // nothing on this phone can open it
        }
    }

    @JavascriptInterface
    public void copyText(String text) {
        host.main.post(() -> {
            ClipboardManager clipboard = (ClipboardManager) app.getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("T-Music", text));
        });
    }

    @JavascriptInterface
    public void moveToBack() {
        host.main.post(() -> {
            MainActivity activity = host.activity();
            if (activity != null) activity.moveTaskToBack(true);
        });
    }

    @JavascriptInterface
    public void saveDocument(String name, String mime, String content) {
        host.main.post(() -> {
            MainActivity activity = host.activity();
            if (activity != null) activity.saveDocument(name, mime, content);
            else emit("saved", "ok", false);
        });
    }

    // ---- friend requests and invitations while the app is in the background ----

    @JavascriptInterface
    public void notify(String id, String title, String body) {
        NotificationManager manager = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(SOCIAL_CHANNEL, "친구와 초대", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(app, MainActivity.class).putExtra(EXTRA_NOTIFICATION, id).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(app, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(app, SOCIAL_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(content)
            .setAutoCancel(true)
            .build();
        try {
            manager.notify(id.hashCode(), notification);
        } catch (SecurityException ignored) {
            // notifications are turned off for this app
        }
    }
}
