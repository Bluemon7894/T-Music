package com.bluemon7894.tmusic;

import android.net.Uri;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

import org.json.JSONException;
import org.json.JSONObject;

// Google blocks sign-in inside an embedded page, so the user signs in from their own browser and the
// answer comes back to a one-time server on this phone, the same way the desktop app does it.
// The answer is kept here until the page takes it: while the user is in the browser, Android may
// start the page over, and the new page picks the sign-in up from where the old one left it.
final class AuthServer {
    private final NativeBridge bridge;
    private ServerSocket server;
    private String listening; // state of the sign-in the server is waiting for
    private String arrivedFor; // state of the sign-in whose answer came back
    private String arrived; // its code, or "" when the user said no

    AuthServer(NativeBridge bridge) {
        this.bridge = bridge;
    }

    synchronized int listen(String state) {
        cancel();
        try {
            ServerSocket socket = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
            server = socket;
            listening = state;
            Thread thread = new Thread(() -> accept(socket, state), "google-sign-in");
            thread.setDaemon(true);
            thread.start();
            return socket.getLocalPort();
        } catch (IOException e) {
            return -1;
        }
    }

    synchronized void cancel() {
        close();
        arrivedFor = null;
        arrived = null;
    }

    // {"code": ...} once the answer is here (taken only once), {"waiting": true} while it may still come,
    // {} when this sign-in is gone (cancelled, or the app was closed in between).
    synchronized String take(String state) {
        if (state == null) return "{}";
        try {
            if (state.equals(arrivedFor)) {
                String code = arrived;
                arrivedFor = null;
                arrived = null;
                return new JSONObject().put("code", code).toString();
            }
            if (server != null && state.equals(listening)) return new JSONObject().put("waiting", true).toString();
        } catch (JSONException ignored) {
            // a string value always fits
        }
        return "{}";
    }

    private synchronized void close() {
        listening = null;
        if (server == null) return;
        try {
            server.close();
        } catch (IOException ignored) {
            // already closed
        }
        server = null;
    }

    private synchronized void arrive(ServerSocket socket, String state, String code) {
        if (server != socket) return; // a newer sign-in took over
        close();
        arrivedFor = state;
        arrived = code;
    }

    private void accept(ServerSocket socket, String state) {
        while (!socket.isClosed()) {
            try (Socket client = socket.accept()) {
                client.setSoTimeout(5000);
                BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), "UTF-8"));
                String line = reader.readLine();
                String[] parts = line == null ? new String[0] : line.split(" ");
                Uri uri = parts.length > 1 ? Uri.parse("http://127.0.0.1" + parts[1]) : null;
                OutputStream out = client.getOutputStream();
                if (uri == null || !"/callback".equals(uri.getPath()) || !state.equals(uri.getQueryParameter("state"))) {
                    out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes("UTF-8"));
                    continue;
                }
                String code = uri.getQueryParameter("code");
                byte[] page = page(code != null).getBytes("UTF-8");
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + page.length + "\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
                out.write(page);
                out.flush();
                arrive(socket, state, code == null ? "" : code);
                bridge.emit("auth");
                return;
            } catch (IOException e) {
                if (socket.isClosed()) return;
            }
        }
    }

    private static String page(boolean signedIn) {
        String title = signedIn ? Lang.say("로그인되었습니다", "Signed in") : Lang.say("로그인이 취소되었습니다", "Sign-in cancelled");
        return "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + title + "</title></head>"
            + "<body style=\"margin:0;height:100vh;display:grid;place-content:center;text-align:center;background:#0a0712;color:#f5f3ff;font-family:system-ui,sans-serif\">"
            + "<h1 style=\"font-size:24px;margin:0 0 20px\">" + title + "</h1>"
            + "<a href=\"tmusic://open\" style=\"display:block;padding:14px 24px;border-radius:14px;background:#7c3aed;color:#fff;font-weight:700;text-decoration:none\">" + Lang.say("T-Music으로 돌아가기", "Back to T-Music") + "</a>"
            + "<script>location.href='tmusic://open'</script></body></html>";
    }
}
