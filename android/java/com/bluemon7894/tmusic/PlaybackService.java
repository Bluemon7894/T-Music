package com.bluemon7894.tmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Keeps the app alive while music plays, and provides the notification, lock screen and headset
// controls. The audio itself plays in the page; this only tells it what the user pressed.
public final class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION_TOGGLE = "tmusic.TOGGLE";
    private static final String ACTION_NEXT = "tmusic.NEXT";
    private static final String ACTION_PREV = "tmusic.PREV";
    private static final String ACTION_CLOSE = "tmusic.CLOSE";
    private static final String EXTRA_STATE = "state";
    private static final long PAUSED_LIFETIME_MS = 10 * 60 * 1000;
    private static final int ART_SIZE = 512;

    private static PlaybackService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable stopAfterPause = this::finish;

    private WebHost host;
    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private boolean hasFocus;
    private boolean resumeOnFocus;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean noisyRegistered;
    private boolean foreground;

    private boolean playing;
    private String title = "";
    private String artist = "";
    private String album = "";
    private String thumb = "";
    private long duration;
    private long position;
    private Bitmap art;
    private String artUrl = "";

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) press("pause");
        }
    };

    // Called with what the page is playing. A null track closes the player.
    static void update(WebHost host, String json) {
        JSONObject state;
        try {
            state = new JSONObject(json);
        } catch (JSONException e) {
            return;
        }
        boolean hasTrack = !state.optString("title").isEmpty();
        if (instance != null) {
            if (hasTrack) instance.apply(state);
            else instance.finish();
            return;
        }
        if (!hasTrack || !state.optBoolean("playing")) return;
        try {
            host.app.startForegroundService(new Intent(host.app, PlaybackService.class).putExtra(EXTRA_STATE, json));
        } catch (RuntimeException e) {
            // Android doesn't let a background app start this. The music plays on, without controls.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        host = WebHost.get(this);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setOnAudioFocusChangeListener(this::onFocusChange, main)
            .build();
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tmusic:playback");
        wakeLock.setReferenceCounted(false);
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "tmusic:playback");
        wifiLock.setReferenceCounted(false);

        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "재생", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);

        session = new MediaSession(this, "T-Music");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { press("play"); }
            @Override public void onPause() { press("pause"); }
            @Override public void onSkipToNext() { press("next"); }
            @Override public void onSkipToPrevious() { press("prev"); }
            @Override public void onStop() { press("pause"); finish(); }
            @Override public void onSeekTo(long ms) { host.bridge.emit("media", "action", "seek", "seconds", ms / 1000.0); }
        });
        session.setSessionActivity(openApp());
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Android requires this promptly after being started, whatever else happens.
        goForeground();
        String action = intent == null ? null : intent.getAction();
        if (ACTION_TOGGLE.equals(action)) press(playing ? "pause" : "play");
        else if (ACTION_NEXT.equals(action)) press("next");
        else if (ACTION_PREV.equals(action)) press("prev");
        else if (ACTION_CLOSE.equals(action)) { press("pause"); finish(); }
        else if (intent != null && intent.hasExtra(EXTRA_STATE)) {
            try {
                apply(new JSONObject(intent.getStringExtra(EXTRA_STATE)));
            } catch (JSONException ignored) {
                // the page sends the state again soon
            }
        }
        return START_NOT_STICKY;
    }

    private void press(String action) {
        host.bridge.emit("media", "action", action);
    }

    private void apply(JSONObject state) {
        boolean wasPlaying = playing;
        playing = state.optBoolean("playing");
        title = state.optString("title");
        artist = state.optString("artist");
        album = state.optString("album");
        thumb = state.optString("thumb");
        duration = (long) (state.optDouble("duration", 0) * 1000);
        position = (long) (state.optDouble("position", 0) * 1000);

        main.removeCallbacks(stopAfterPause);
        if (playing) {
            if (!hasFocus) hasFocus = audio.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            resumeOnFocus = false;
            wakeLock.acquire();
            wifiLock.acquire();
            if (!noisyRegistered) {
                registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
                noisyRegistered = true;
            }
        } else {
            if (wakeLock.isHeld()) wakeLock.release();
            if (wifiLock.isHeld()) wifiLock.release();
            if (noisyRegistered) {
                unregisterReceiver(noisy);
                noisyRegistered = false;
            }
            if (!resumeOnFocus && hasFocus) {
                audio.abandonAudioFocusRequest(focusRequest);
                hasFocus = false;
            }
            main.postDelayed(stopAfterPause, PAUSED_LIFETIME_MS);
        }

        session.setPlaybackState(new PlaybackState.Builder()
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f, SystemClock.elapsedRealtime())
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP)
            .build());
        publishMetadata();
        if (!thumb.equals(artUrl)) loadArt(thumb);
        goForeground();
    }

    private void publishMetadata() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (art != null) metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(metadata.build());
    }

    private void loadArt(String url) {
        artUrl = url;
        art = null;
        if (!url.startsWith("https://")) return;
        Thread thread = new Thread(() -> {
            Bitmap loaded = fetchArt(url);
            main.post(() -> {
                if (instance != this || !url.equals(artUrl)) return;
                art = loaded;
                publishMetadata();
                goForeground();
            });
        }, "album-art");
        thread.setDaemon(true);
        thread.start();
    }

    private static Bitmap fetchArt(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            try (InputStream in = c.getInputStream()) {
                Bitmap image = BitmapFactory.decodeStream(in);
                if (image == null) return null;
                int side = Math.min(image.getWidth(), image.getHeight());
                Bitmap square = Bitmap.createBitmap(image, (image.getWidth() - side) / 2, (image.getHeight() - side) / 2, side, side);
                return side > ART_SIZE ? Bitmap.createScaledBitmap(square, ART_SIZE, ART_SIZE, true) : square;
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void onFocusChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                hasFocus = false;
                resumeOnFocus = false;
                press("pause");
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (playing) resumeOnFocus = true;
                press("pause");
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true;
                if (resumeOnFocus) press("play");
                resumeOnFocus = false;
                break;
            default:
                break; // the system lowers the volume by itself when it only needs to duck
        }
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification.Action action(int icon, String label, String name) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(name);
        PendingIntent pending = PendingIntent.getService(this, name.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, icon), label, pending).build();
    }

    private void goForeground() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title.isEmpty() ? "T-Music" : title)
            .setContentText(artist)
            .setContentIntent(openApp())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .addAction(action(R.drawable.ic_prev, "이전 곡", ACTION_PREV))
            .addAction(action(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "일시정지" : "재생", ACTION_TOGGLE))
            .addAction(action(R.drawable.ic_next, "다음 곡", ACTION_NEXT))
            .addAction(action(R.drawable.ic_close, "닫기", ACTION_CLOSE))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (art != null) builder.setLargeIcon(art);
        Notification notification = builder.build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION_ID, notification);
            foreground = true;
        } catch (RuntimeException e) {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification);
        }
    }

    private void finish() {
        main.removeCallbacks(stopAfterPause);
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE);
        foreground = false;
        stopSelf();
    }

    // Swiping the app away while music plays leaves it playing, as music apps do. Otherwise it's done.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!playing) finish();
    }

    @Override
    public void onDestroy() {
        instance = null;
        main.removeCallbacks(stopAfterPause);
        if (wakeLock.isHeld()) wakeLock.release();
        if (wifiLock.isHeld()) wifiLock.release();
        if (noisyRegistered) unregisterReceiver(noisy);
        audio.abandonAudioFocusRequest(focusRequest);
        session.setActive(false);
        session.release();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIFICATION_ID);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
