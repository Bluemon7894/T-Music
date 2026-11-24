package com.bluemon7894.tmusic;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

// Push from Firebase (functions/index.js) while the app isn't running, through Google Play services' own
// messaging, which every phone with the Play Store has. The app has no Google libraries, so it asks Play
// services directly for an address and is handed the messages as broadcasts. A phone without Play
// services, or one that never answers, still gets invites from WakeCheck, only later.
public final class Push extends BroadcastReceiver {
    static final String SENDER = "520412577442"; // the Firebase project's number
    private static final String PREFS = "push";
    private static final String GMS = "com.google.android.gms";

    static String token(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", "");
    }

    static boolean available(Context context) {
        try {
            context.getPackageManager().getPackageInfo(GMS, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    // Asks for an address. The answer comes back as a REGISTRATION broadcast to onReceive.
    static void register(Context context) {
        if (!available(context)) return;
        Intent intent = new Intent("com.google.android.c2dm.intent.REGISTER").setPackage(GMS);
        intent.putExtra("app", PendingIntent.getBroadcast(context, 0, new Intent(), PendingIntent.FLAG_IMMUTABLE));
        intent.putExtra("sender", SENDER);
        intent.putExtra("subtype", SENDER);
        intent.putExtra("scope", "*");
        try {
            context.startService(intent);
        } catch (RuntimeException e) {
            // Play services refused or isn't running: the fifteen-minute check still works
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if ("com.google.android.c2dm.intent.REGISTRATION".equals(action)) {
            String token = intent.getStringExtra("registration_id");
            if (token == null || token.isEmpty()) return;
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("token", token).apply();
            WebHost host = WebHost.peek();
            if (host != null) host.bridge.emit("pushToken", "token", token);
            return;
        }
        if (!"com.google.android.c2dm.intent.RECEIVE".equals(action)) return;
        String type = intent.getStringExtra("type");
        String id = intent.getStringExtra("id");
        String from = intent.getStringExtra("fromName");
        if ("invite".equals(type)) {
            String code = intent.getStringExtra("code");
            if (code == null || !code.matches("[A-Za-z0-9]{6}")) return;
            WakeCheck.showInvite(context, "push:" + id, from == null ? "" : from, intent.getStringExtra("roomName"), code);
        } else if ("friendRequest".equals(type)) {
            WakeCheck.showFriendRequest(context, "request:" + id, from == null ? "" : from);
        }
    }
}
