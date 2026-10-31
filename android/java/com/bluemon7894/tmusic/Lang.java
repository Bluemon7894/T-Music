package com.bluemon7894.tmusic;

import android.content.Context;

// The page's language, for the text the app shows outside it: notifications, dialogs, the sign-in page.
// It's saved because the first of those can appear before the page has loaded.
final class Lang {
    private static final String PREFS = "t-music-language";
    private static final String KEY = "language";

    private static volatile boolean english;

    private Lang() {}

    static void load(Context context) {
        english = "en".equals(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "ko"));
    }

    static void set(Context context, String language) {
        english = "en".equals(language);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, english ? "en" : "ko").apply();
    }

    static String say(String ko, String en) {
        return english ? en : ko;
    }
}
