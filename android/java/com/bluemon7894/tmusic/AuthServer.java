package com.bluemon7894.tmusic;

import android.net.Uri;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

// Google blocks sign-in inside an embedded page, so the user signs in from their own browser and the
// answer comes back to a one-time server on this phone, the same way the desktop app does it.
final class AuthServer {
    private final NativeBridge bridge;
    private ServerSocket server;

    AuthServer(NativeBridge bridge) {
        this.bridge = bridge;
    }

    synchronized int listen(String state) {
        cancel();
        try {
            ServerSocket socket = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
            server = socket;
            Thread thread = new Thread(() -> accept(socket, state), "google-sign-in");
            thread.setDaemon(true);
            thread.start();
            return socket.getLocalPort();
        } catch (IOException e) {
            return -1;
        }
    }

    synchronized void cancel() {
        if (server == null) return;
        try {
            server.close();
        } catch (IOException ignored) {
            // already closed
        }
        server = null;
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
                bridge.emit("auth", "code", code == null ? "" : code);
                cancel();
                return;
            } catch (IOException e) {
                if (socket.isClosed()) return;
            }
        }
    }

    private static String page(boolean signedIn) {
        String title = signedIn ? "로그인되었습니다" : "로그인이 취소되었습니다";
        return "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + title + "</title></head>"
            + "<body style=\"margin:0;height:100vh;display:grid;place-content:center;text-align:center;background:#0a0712;color:#f5f3ff;font-family:system-ui,sans-serif\">"
            + "<h1 style=\"font-size:24px;margin:0 0 20px\">" + title + "</h1>"
            + "<a href=\"tmusic://open\" style=\"display:block;padding:14px 24px;border-radius:14px;background:#7c3aed;color:#fff;font-weight:700;text-decoration:none\">T-Music으로 돌아가기</a>"
            + "<script>location.href='tmusic://open'</script></body></html>";
    }
}
