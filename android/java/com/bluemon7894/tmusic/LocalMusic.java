package com.bluemon7894.tmusic;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// Music already on the phone, whatever app put it there, as the system's media library lists it. Ids
// look like YouTube's but end in Z, which a YouTube id never does (see electron/localId.js).
final class LocalMusic {
    private static final int MAX_TRACKS = 5000;
    private static final int ART_SIZE = 320;
    private static final Map<String, Uri> uris = new ConcurrentHashMap<>();

    private LocalMusic() {}

    static String permission() {
        return Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    static boolean allowed(Context context) {
        return context.checkSelfPermission(permission()) == PackageManager.PERMISSION_GRANTED;
    }

    static String idOf(Uri uri) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-1").digest(uri.toString().getBytes(StandardCharsets.UTF_8));
            String text = Base64.encodeToString(hash, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            return text.substring(0, 10) + "Z";
        } catch (Exception e) {
            return null;
        }
    }

    static String list(Context context) {
        JSONArray out = new JSONArray();
        if (!allowed(context)) return out.toString();
        String[] columns = { MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION };
        try (Cursor c = context.getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, columns,
                MediaStore.Audio.Media.IS_MUSIC + " != 0", null, MediaStore.Audio.Media.TITLE + " COLLATE NOCASE")) {
            if (c == null) return out.toString();
            while (c.moveToNext() && out.length() < MAX_TRACKS) {
                Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, c.getLong(0));
                String id = idOf(uri);
                if (id == null) continue;
                uris.put(id, uri);
                String artist = c.getString(2);
                if ("<unknown>".equals(artist)) artist = null;
                JSONObject track = new JSONObject();
                track.put("id", id);
                track.put("title", c.getString(1) == null ? "" : c.getString(1));
                JSONArray artists = new JSONArray();
                if (artist != null && !artist.isEmpty()) artists.put(new JSONObject().put("name", artist));
                track.put("artists", artists);
                String album = c.getString(3);
                if (album != null && !album.isEmpty()) track.put("album", new JSONObject().put("name", album));
                track.put("duration", Math.round(c.getLong(4) / 1000.0));
                if (Build.VERSION.SDK_INT >= 29) track.put("thumb", "/art/" + id);
                out.put(track);
            }
        } catch (RuntimeException | JSONException e) {
            // a phone whose media library can't be read: no list, nothing broken
        }
        return out.toString();
    }

    static Uri uriOf(Context context, String id) {
        Uri uri = uris.get(id);
        if (uri == null && allowed(context)) {
            list(context); // after a restart the ids are known again once the library has been read
            uri = uris.get(id);
        }
        return uri;
    }

    static AssetFileDescriptor open(Context context, String id) {
        Uri uri = uriOf(context, id);
        if (uri == null) return null;
        try {
            return context.getContentResolver().openAssetFileDescriptor(uri, "r");
        } catch (Exception e) {
            return null;
        }
    }

    static String mimeOf(Context context, String id) {
        Uri uri = uriOf(context, id);
        String type = uri == null ? null : context.getContentResolver().getType(uri);
        return type == null ? "audio/mpeg" : type;
    }

    static byte[] art(Context context, String id) {
        if (Build.VERSION.SDK_INT < 29) return null;
        Uri uri = uriOf(context, id);
        if (uri == null) return null;
        try {
            Bitmap bitmap = context.getContentResolver().loadThumbnail(uri, new Size(ART_SIZE, ART_SIZE), null);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, bytes);
            return bytes.toByteArray();
        } catch (Exception e) {
            return null; // no picture in this file
        }
    }
}
