package com.bluemon7894.tmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

// A friend waking this phone to listen together, while the app isn't running. There's no push server, so
// the phone looks every fifteen minutes or so (the least Android allows) in its own box, whose address only
// its friends are told, and shows what it finds as a notification. Tapping it opens the room.
public final class WakeCheck extends JobService {
    private static final int JOB_ID = 7301;
    private static final String PREFS = "wake";
    private static final String BOX = "https://t-music-b8301-default-rtdb.asia-southeast1.firebasedatabase.app/wakeBox/";
    private static final long FRESH_MS = 2 * 60 * 60 * 1000L; // an older wake-up isn't worth showing
    private static final String CHANNEL = "social";

    static String secret(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getString("secret", "");
    }

    // Empty turns the checks off, as when signing out.
    static void setSecret(Context context, String secret) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("secret", secret == null ? "" : secret).apply();
        JobScheduler jobs = context.getSystemService(JobScheduler.class);
        if (jobs == null) return;
        if (secret == null || secret.isEmpty()) {
            jobs.cancel(JOB_ID);
            return;
        }
        jobs.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, WakeCheck.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(15 * 60 * 1000L)
            .setPersisted(true)
            .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                check(this);
            } catch (Exception ignored) {
                // tried again on the next run
            }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }

    private static void check(Context context) throws Exception {
        String secret = secret(context);
        if (secret.isEmpty()) return;
        HttpURLConnection c = (HttpURLConnection) new URL(BOX + secret + ".json").openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        String body;
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            body = out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
        if (body == null || body.equals("null")) return;
        JSONObject box = new JSONObject(body);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        long seen = prefs.getLong("seen", 0);
        long newest = seen;
        long now = System.currentTimeMillis();
        for (Iterator<String> keys = box.keys(); keys.hasNext(); ) {
            String key = keys.next();
            JSONObject wake = box.optJSONObject(key);
            if (wake == null) continue;
            long at = wake.optLong("at", 0);
            if (at <= seen || now - at > FRESH_MS) continue;
            String code = wake.optString("code", "");
            if (!code.matches("[A-Za-z0-9]{6}")) continue;
            newest = Math.max(newest, at);
            showInvite(context, key, wake.optString("fromName", ""), wake.optString("roomName", ""), code);
        }
        if (newest > seen) prefs.edit().putLong("seen", newest).apply();
    }

    // Both ways an invite can arrive (this check and a push, Push.java) tag it by the room, so the same
    // invite seen twice replaces itself instead of showing two notifications.
    static void showInvite(Context context, String key, String from, String room, String code) {
        String name = from == null || from.isEmpty() ? Lang.say("친구", "A friend") : from;
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("tmusic://join/" + code), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Lang.load(context);
        post(context, "invite:" + code, open,
            Lang.say(name + "님이 같이 듣자고 해요", name + " wants to listen together"),
            room == null || room.isEmpty() ? Lang.say("눌러서 같이 듣기 방에 들어가요", "Tap to join the room") : Lang.say("'" + room + "' 방에서 기다리고 있어요", "Waiting in '" + room + "'"));
    }

    // One notification per room, replaced by each new message, so a talkative room doesn't pile them up.
    static void showChat(Context context, String code, String from, String text) {
        if (code == null || !code.matches("[A-Za-z0-9]{6}")) return;
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Lang.load(context);
        post(context, "chat:" + code, open, from == null || from.isEmpty() ? Lang.say("같이 듣기", "Listen together") : from, text == null ? "" : text);
    }

    static void showFriendRequest(Context context, String key, String from) {
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Lang.load(context);
        String name = from == null || from.isEmpty() ? Lang.say("누군가", "Someone") : from;
        post(context, key, open, Lang.say(name + "님이 친구 요청을 보냈어요", name + " sent you a friend request"), Lang.say("눌러서 확인해요", "Tap to see it"));
    }

    private static void post(Context context, String key, Intent open, String title, String text) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, Lang.say("친구와 초대", "Friends and invites"), NotificationManager.IMPORTANCE_HIGH));
        PendingIntent content = PendingIntent.getActivity(context, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setAutoCancel(true)
            .build();
        try {
            manager.notify(key.hashCode(), notification);
        } catch (SecurityException ignored) {
            // notifications are turned off for this app
        }
    }
}
