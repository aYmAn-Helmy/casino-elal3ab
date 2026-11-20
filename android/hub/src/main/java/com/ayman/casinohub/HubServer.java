package com.ayman.casinohub;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.nanohttpd.protocols.http.IHTTPSession;
import org.nanohttpd.protocols.http.NanoHTTPD;
import org.nanohttpd.protocols.http.response.Response;
import org.nanohttpd.protocols.http.response.Status;
import org.nanohttpd.protocols.websockets.NanoWSD;
import org.nanohttpd.protocols.websockets.WebSocket;
import org.nanohttpd.protocols.websockets.WebSocketFrame;
import org.nanohttpd.protocols.websockets.WebSocketFrame.CloseCode;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Embedded HTTP + WebSocket hub, compatible with existing /play, /admin and /screen.
 * The first valid packet processed by this synchronized hub wins the buzzer.
 * The host PIN and all SQLite records stay on the host phone.
 */
public final class HubServer extends NanoWSD {
    private static final String TAG = "CasinoHub";
    public static final int PORT = 3000;

    private final AssetManager assets;
    private final HubStore store;
    private final String adminPin;
    private final BuzzerRules rules = new BuzzerRules();
    private final Set<Client> clients = new HashSet<>();
    private final Map<String, Client> activePlayers = new HashMap<>();

    public HubServer(Context context, String pin) throws Exception {
        super(PORT);
        assets = context.getApplicationContext().getAssets();
        store = new HubStore(context);
        adminPin = pin;
    }

    private Response text(Status status, String value) {
        Response response = Response.newFixedLengthResponse(status, "text/plain; charset=utf-8", value);
        response.addHeader("Cache-Control", "no-store");
        return response;
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (session.getMethod() != NanoHTTPD.Method.GET &&
                session.getMethod() != NanoHTTPD.Method.HEAD) {
            return text(Status.METHOD_NOT_ALLOWED, "Only GET");
        }
        final String pathname = session.getUri();
        if ("/api/health".equals(pathname)) {
            try {
                JSONObject health = new JSONObject();
                synchronized (this) {
                    health.put("ok", true);
                    health.put("app", "Casino Phone Hub");
                    health.put("questions", store.stats().getInt("total"));
                    health.put("players", store.players(activePlayers.keySet()).length());
                    health.put("apkReady", false);
                }
                Response response = Response.newFixedLengthResponse(Status.OK, "application/json; charset=utf-8",
                        health.toString());
                response.addHeader("Cache-Control", "no-store");
                return response;
            } catch (Exception e) {
                return text(Status.INTERNAL_ERROR, "Health unavailable");
            }
        }
        if ("/download".equals(pathname)) {
            return text(Status.NOT_FOUND, "Install the player APK separately or use /play in your browser.");
        }
        String file;
        switch (pathname) {
            case "/": file = "index.html"; break;
            case "/play": file = "play.html"; break;
            case "/admin": file = "admin.html"; break;
            case "/screen": file = "screen.html"; break;
            case "/style.css": case "/shared.js": case "/audio.js":
            case "/play.js": case "/admin.js": case "/screen.js":
                file = pathname.substring(1); break;
            case "/bell.mp3": file = "bell.mp3"; break;
            default: return text(Status.NOT_FOUND, "Not found");
        }
        String mime = file.endsWith(".html") ? "text/html; charset=utf-8" :
                file.endsWith(".css") ? "text/css; charset=utf-8" :
                file.endsWith(".js") ? "text/javascript; charset=utf-8" :
                "audio/mpeg";
        // The rest of the web bundle is provided directly from the repository's public/ folder.
        String assetName = "bell.mp3".equals(file) ? "bell.mp3" : file;
        try {
            InputStream input = assets.open(assetName);
            Response response = Response.newFixedLengthResponse(Status.OK, mime, input, input.available());
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("X-Content-Type-Options", "nosniff");
            response.addHeader("Referrer-Policy", "no-referrer");
            response.addHeader("Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws:; " +
                    "img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
            return response;
        } catch (IOException e) {
            // Missing bell.mp3 is handled by the browser's synthesized offline fallback.
            return text(Status.NOT_FOUND, "Asset unavailable");
        }
    }

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        // Browser WS Origin must match the requested LAN host. This prevents
        // another website from silently sending commands to the local hub.
        String host = handshake.getHeaders().get("host");
        String origin = handshake.getHeaders().get("origin");
        boolean allowed = "/ws".equals(handshake.getUri());
        if (origin != null && host != null) {
            try {
                java.net.URI parsed = new java.net.URI(origin);
                allowed &= (parsed.getHost() != null && host.equalsIgnoreCase(
                        parsed.getHost() + (parsed.getPort() == -1 ? "" : ":" + parsed.getPort())));
            } catch (Exception e) { allowed = false; }
        }
        return new Client(handshake, allowed);
    }

    private JSONObject state() throws Exception {
        JSONObject data = new JSONObject();
        data.put("roomName", "كازينو الألعاب — موبايل Hub");
        data.put("phase", rules.phase);
        data.put("roundId", rules.roundId);
        data.put("winnerId", rules.winnerId == null ? JSONObject.NULL : rules.winnerId);
        JSONObject winner = store.getPlayer(rules.winnerId);
        data.put("winnerName", winner == null ? JSONObject.NULL : winner.getString("name"));
        data.put("players", store.players(activePlayers.keySet()));
        JSONObject q = store.publicCurrent();
        data.put("question", q == null ? JSONObject.NULL : q);
        data.put("questionStats", store.stats());
        data.put("correctPoints", 1);
        data.put("wrongPoints", 1);
        data.put("lastEvent", rules.lastEvent);
        data.put("serverTime", System.currentTimeMillis());
        return data;
    }

    private static void send(Client client, String type, JSONObject details) {
        try {
            if (!client.isOpen()) return;
            JSONObject message = new JSONObject();
            message.put("type", type);
            if (details != null) {
                for (java.util.Iterator<String> keys = details.keys(); keys.hasNext();) {
                    String key = keys.next();
                    message.put(key, details.get(key));
                }
            }
            client.send(message.toString());
        } catch (Exception e) {
            Log.w(TAG, "Client send failed: " + e.getMessage());
        }
    }

    private static JSONObject message(String key, Object value) throws Exception {
        return new JSONObject().put(key, value);
    }

    private void broadcast() throws Exception {
        JSONObject payload = message("state", state());
        for (Client client : new ArrayList<>(clients)) send(client, "state", payload);
    }

    private void sendHostQuestion(Client only) {
        JSONObject current = store.hostCurrent();
        try {
            send(only, "host-question",
                    message("question", current == null ? JSONObject.NULL : current));
        } catch (Exception ignored) { }
    }

    private void broadcastHostQuestion() {
        for (Client c : new ArrayList<>(clients)) if (c.isHost) sendHostQuestion(c);
    }

    private void kick(Client client, String reason) {
        try { send(client, "kicked", message("message", reason)); }
        catch (Exception ignored) {}
    }

    private synchronized void onConnect(Client client) {
        clients.add(client);
        try { send(client, "state", message("state", state())); }
        catch (Exception e) { Log.e(TAG, "Init state failed", e); }
    }

    private synchronized void onDisconnect(Client client) {
        clients.remove(client);
        if (client.playerId != null && activePlayers.get(client.playerId) == client) {
            activePlayers.remove(client.playerId);
            try { broadcast(); } catch (Exception ignored) {}
        }
    }

    private static boolean verifyPin(String provided, String expected) {
        return MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8),
                expected.getBytes(StandardCharsets.UTF_8));
    }

    private synchronized void onClientMessage(Client client, String raw) {
        if (!client.allowed) {
            send(client, "error", error("مسموح الاتصال من نفس صفحة السيرفر فقط"));
            return;
        }
        if (raw == null || raw.length() > 2_200_000) {
            send(client, "error", error("الرسالة كبيرة جدًا"));
            return;
        }
        try {
            JSONObject obj = new JSONObject(raw);
            String type = obj.optString("type", "");
            switch (type) {
                case "join": {
                    JSONObject joined = store.join(obj.optString("name", ""),
                            obj.optString("token", ""));
                    String id = joined.getString("id");
                    Client previous = activePlayers.get(id);
                    if (previous != null && previous != client) {
                        send(previous, "error", error("تم تسجيل الدخول من جهاز تاني"));
                        previous.playerId = null;
                        try { previous.close(CloseCode.NormalClosure, "Another session", false); }
                        catch (IOException ignored) {}
                    }
                    if (client.playerId != null && !client.playerId.equals(id)
                            && activePlayers.get(client.playerId) == client) {
                        activePlayers.remove(client.playerId);
                    }
                    client.playerId = id;
                    activePlayers.put(id, client);
                    send(client, "joined", message("player", joined));
                    broadcast();
                    break;
                }
                case "buzz": {
                    if (client.playerId == null || activePlayers.get(client.playerId) != client) {
                        send(client, "error", error("لازم تدخل باسمك الأول"));
                        break;
                    }
                    String rejected = rules.buzz(client.playerId, obj.optInt("roundId", -1));
                    JSONObject result = new JSONObject().put("ok", rejected == null)
                            .put("reason", rejected == null ? "أنت أول واحد وصل للسيرفر" : rejected);
                    send(client, "buzz-result", result);
                    if (rejected == null) {
                        JSONObject player = store.getPlayer(client.playerId);
                        rules.lastEvent = player.getString("name") + " كسب الجرس";
                        broadcast();
                    }
                    break;
                }
                case "host-login": {
                    if (client.failedLogins >= 5) {
                        send(client, "error", error("محاولات دخول كتير"));
                        break;
                    }
                    if (!verifyPin(obj.optString("pin", ""), adminPin)) {
                        client.failedLogins++;
                        send(client, "error", error("كلمة مرور المذيع غلط"));
                        break;
                    }
                    client.isHost = true;
                    client.failedLogins = 0;
                    send(client, "host-ok", null);
                    send(client, "state", message("state", state()));
                    sendHostQuestion(client);
                    break;
                }
                case "host-action": {
                    if (!client.isHost) {
                        send(client, "error", error("مطلوب تسجيل دخول المذيع"));
                        break;
                    }
                    String action = obj.optString("action", "");
                    switch (action) {
                        case "open": rules.open(); break;
                        case "correct": {
                            if (!"answering".equals(rules.phase)) throw new IllegalStateException("مفيش لاعب بيجاوب");
                            String winnerId = rules.winnerId;
                            JSONObject winner = store.getPlayer(winnerId);
                            if (winner == null) throw new IllegalStateException("اللاعب مش موجود");
                            store.adjustScore(winnerId, +1);
                            rules.correct();
                            rules.lastEvent = winner.getString("name") + " جاوب صح (+1)";
                            Client recipient = activePlayers.get(winnerId);
                            if (recipient != null) {
                                send(recipient, "answer-correct",
                                        new JSONObject().put("playerId", winnerId)
                                                .put("roundId", rules.roundId).put("points", 1));
                            }
                            break;
                        }
                        case "wrong": {
                            if (!"answering".equals(rules.phase)) throw new IllegalStateException("مفيش لاعب بيجاوب");
                            String wrongId = rules.winnerId;
                            JSONObject player = store.getPlayer(wrongId);
                            if (player == null) throw new IllegalStateException("اللاعب مش موجود");
                            store.adjustScore(wrongId, -1);
                            rules.wrong(!activePlayers.isEmpty());
                            rules.lastEvent = player.getString("name") + " جاوب غلط (-1) — الجرس مفتوح للكل";
                            break;
                        }
                        case "yellow-card": case "red-card": {
                            String id = obj.optString("playerId", "");
                            JSONObject p = store.getPlayer(id);
                            String color = action.equals("yellow-card") ? "yellow" : "red";
                            store.card(id, color);
                            rules.lastEvent = p.getString("name") + " أخذ كارت " +
                                    (color.equals("yellow") ? "أصفر (-1)" : "أحمر (-3)");
                            break;
                        }
                        case "close": rules.close(); break;
                        case "next-question": {
                            if ("answering".equals(rules.phase)) throw new IllegalStateException("احسم الإجابة الأول");
                            String category = obj.optString("category", "");
                            JSONObject q = store.nextQuestion(category.isEmpty() ? null : category);
                            rules.close();
                            rules.lastEvent = "سؤال جديد — " + q.getString("category");
                            break;
                        }
                        case "reset-question-usage": {
                            if ("answering".equals(rules.phase)) throw new IllegalStateException("احسم الإجابة الأول");
                            store.resetQuestionUsage();
                            rules.close();
                            rules.lastEvent = "تمت إعادة الأسئلة لقائمة الأسئلة المتاحة";
                            break;
                        }
                        case "reset-scores":
                            store.resetScores(); rules.close(); rules.lastEvent = "تم تصفير كل النقاط"; break;
                        case "clear-players":
                            store.clearPlayers();
                            for (Client other : activePlayers.values()) {
                                other.playerId = null;
                                kick(other, "المذيع مسح اللاعبين، ادخل باسمك من جديد");
                            }
                            activePlayers.clear();
                            rules.reset();
                            break;
                        default: throw new IllegalArgumentException("أمر غير معروف");
                    }
                    broadcast();
                    broadcastHostQuestion();
                    break;
                }
                case "questions-import": {
                    if (!client.isHost) {
                        send(client, "error", error("مطلوب تسجيل دخول المذيع"));
                        break;
                    }
                    if ("answering".equals(rules.phase))
                        throw new IllegalStateException("احسم الإجابة الأول");
                    JSONArray questions = obj.optJSONArray("questions");
                    store.replaceQuestions(questions);
                    rules.close();
                    rules.lastEvent = "تم استيراد بنك الأسئلة الجديد";
                    send(client, "import-ok", message("count", store.stats().getInt("total")));
                    broadcast();
                    broadcastHostQuestion();
                    break;
                }
                default: send(client, "error", error("نوع رسالة غير معروف"));
            }
        } catch (Exception e) {
            Log.w(TAG, "Client operation rejected: " + e.getMessage());
            send(client, "error", error(e.getMessage() == null ? "حصل خطأ" : e.getMessage()));
        }
    }

    private static JSONObject error(String detail) {
        try { return message("message", detail); }
        catch (Exception e) { return new JSONObject(); }
    }

    public synchronized void shutdown() {
        for (Client c : new ArrayList<>(clients)) {
            try { c.close(CloseCode.GoingAway, "Hub stopped", false); }
            catch (IOException ignored) {}
        }
        clients.clear();
        activePlayers.clear();
        stop();
        store.close();
    }

    private final class Client extends WebSocket {
        final boolean allowed;
        String playerId;
        boolean isHost;
        int failedLogins;

        Client(IHTTPSession handshake, boolean allowed) {
            super(handshake);
            this.allowed = allowed;
        }

        @Override protected void onOpen() {
            if (!allowed) {
                try { close(CloseCode.PolicyViolation, "Disallowed origin/path", false); }
                catch (IOException ignored) {}
                return;
            }
            onConnect(this);
        }
        @Override protected void onMessage(WebSocketFrame frame) {
            if (frame.getOpCode() != WebSocketFrame.OpCode.Text) return;
            try { onClientMessage(this, frame.getTextPayload()); }
            catch (Exception e) { send(this, "error", error("صيغة رسالة غير صحيحة")); }
        }
        @Override protected void onPong(WebSocketFrame frame) { }
        @Override protected void onClose(CloseCode code, String reason, boolean initiatedByRemote) {
            onDisconnect(this);
        }
        @Override protected void onException(IOException exception) {
            Log.w(TAG, "WebSocket closed: " + exception.getMessage());
            onDisconnect(this);
        }
    }
}
