package com.ayman.casinohub;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Local persistent game records. Nothing is uploaded or requires a cloud account. */
public final class HubStore extends SQLiteOpenHelper {
    private final Context app;
    private final SecureRandom random = new SecureRandom();
    private JSONObject selectedQuestion;

    public HubStore(Context context) throws Exception {
        super(context.getApplicationContext(), "casino-phone-hub.db", null, 1);
        app = context.getApplicationContext();
        setWriteAheadLoggingEnabled(true);
        if (count("questions") == 0) {
            try (InputStream in = app.getAssets().open("text_only_1000.json")) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) != -1) bytes.write(chunk, 0, n);
                JSONArray seeds = new JSONObject(bytes.toString("UTF-8")).getJSONArray("questions");
                replaceQuestions(seeds);
            }
        }
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS players (" +
                "id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL," +
                "score INTEGER NOT NULL DEFAULT 0, yellow_cards INTEGER NOT NULL DEFAULT 0," +
                "red_cards INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
        db.execSQL("CREATE TABLE IF NOT EXISTS questions (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, answer TEXT NOT NULL," +
                "category TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT ''," +
                "used INTEGER NOT NULL DEFAULT 0)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Version 1 starts with a separate SQLite database; future migrations preserve data.
    }

    private int count(String table) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + table, null)) {
            c.moveToFirst();
            return c.getInt(0);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder b = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) b.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return b.toString();
    }

    private static String sha256(String value) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static JSONObject player(Cursor c) throws Exception {
        JSONObject p = new JSONObject();
        p.put("id", c.getString(c.getColumnIndexOrThrow("id")));
        p.put("name", c.getString(c.getColumnIndexOrThrow("name")));
        p.put("score", c.getInt(c.getColumnIndexOrThrow("score")));
        p.put("yellow_cards", c.getInt(c.getColumnIndexOrThrow("yellow_cards")));
        p.put("red_cards", c.getInt(c.getColumnIndexOrThrow("red_cards")));
        return p;
    }

    public synchronized JSONObject getPlayer(String id) throws Exception {
        if (id == null) return null;
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,name,score,yellow_cards,red_cards FROM players WHERE id=?",
                new String[]{id})) {
            return c.moveToFirst() ? player(c) : null;
        }
    }

    public synchronized JSONObject join(String givenName, String token) throws Exception {
        String name = givenName == null ? "" : givenName.trim().replaceAll("\\s+", " ");
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 24)
            throw new IllegalArgumentException("الاسم لازم يكون من 1 إلى 24 حرف");
        if (token != null && token.matches("[a-f0-9]{64}")) {
            try (Cursor c = getReadableDatabase().rawQuery(
                    "SELECT id FROM players WHERE token_hash=?", new String[]{sha256(token)})) {
                if (c.moveToFirst()) {
                    String id = c.getString(0);
                    ContentValues values = new ContentValues();
                    values.put("name", name);
                    getWritableDatabase().update("players", values, "id=?", new String[]{id});
                    JSONObject joined = getPlayer(id);
                    joined.put("token", token);
                    return joined;
                }
            }
        }
        if (count("players") >= 20)
            throw new IllegalArgumentException("الغرفة ممتلئة؛ اطلب من المذيع مسح اللاعبين القديمة");
        String id = java.util.UUID.randomUUID().toString();
        byte[] secret = new byte[32];
        random.nextBytes(secret);
        String freshToken = hex(secret);
        ContentValues values = new ContentValues();
        values.put("id", id);
        values.put("token_hash", sha256(freshToken));
        values.put("name", name);
        values.put("score", 0);
        if (getWritableDatabase().insertOrThrow("players", null, values) < 0)
            throw new IllegalStateException("تعذر إضافة اللاعب");
        JSONObject joined = getPlayer(id);
        joined.put("token", freshToken);
        return joined;
    }

    public synchronized JSONArray players(Set<String> connected) throws Exception {
        JSONArray list = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,name,score,yellow_cards,red_cards FROM players " +
                        "ORDER BY score DESC, created_at ASC, id ASC", null)) {
            while (c.moveToNext()) {
                JSONObject p = player(c);
                p.put("connected", connected.contains(p.getString("id")));
                p.put("excluded", false);
                list.put(p);
            }
        }
        return list;
    }

    public synchronized void adjustScore(String id, int points) throws Exception {
        if (getPlayer(id) == null) throw new IllegalArgumentException("اللاعب المطلوب غير موجود");
        getWritableDatabase().execSQL("UPDATE players SET score=score+? WHERE id=?",
                new Object[]{points, id});
    }

    public synchronized void card(String id, String color) throws Exception {
        if (getPlayer(id) == null) throw new IllegalArgumentException("اللاعب المطلوب غير موجود");
        if ("yellow".equals(color)) {
            getWritableDatabase().execSQL(
                    "UPDATE players SET score=score-1,yellow_cards=yellow_cards+1 WHERE id=?",
                    new Object[]{id});
        } else if ("red".equals(color)) {
            getWritableDatabase().execSQL(
                    "UPDATE players SET score=score-3,red_cards=red_cards+1 WHERE id=?",
                    new Object[]{id});
        } else throw new IllegalArgumentException("نوع الكارت غير صحيح");
    }

    public synchronized void resetScores() {
        getWritableDatabase().execSQL(
                "UPDATE players SET score=0,yellow_cards=0,red_cards=0");
    }

    public synchronized void clearPlayers() {
        getWritableDatabase().delete("players", null, null);
    }

    public synchronized JSONObject stats() throws Exception {
        JSONObject total = new JSONObject();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT COUNT(*),COALESCE(SUM(CASE WHEN used=0 THEN 1 ELSE 0 END),0) FROM questions", null)) {
            c.moveToFirst();
            total.put("total", c.getInt(0));
            total.put("remaining", c.getInt(1));
        }
        JSONArray categories = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT category,COUNT(*),COALESCE(SUM(CASE WHEN used=0 THEN 1 ELSE 0 END),0)" +
                        " FROM questions GROUP BY category ORDER BY category", null)) {
            while (c.moveToNext()) {
                JSONObject category = new JSONObject();
                category.put("category", c.getString(0));
                category.put("total", c.getInt(1));
                category.put("remaining", c.getInt(2));
                categories.put(category);
            }
        }
        total.put("categories", categories);
        return total;
    }

    public synchronized JSONObject hostCurrent() { return selectedQuestion; }

    public synchronized JSONObject publicCurrent() throws Exception {
        if (selectedQuestion == null) return null;
        JSONObject publicQuestion = new JSONObject();
        publicQuestion.put("id", selectedQuestion.getInt("id"));
        publicQuestion.put("text", selectedQuestion.getString("text"));
        publicQuestion.put("category", selectedQuestion.getString("category"));
        return publicQuestion;
    }

    private static JSONObject question(Cursor c) throws Exception {
        JSONObject q = new JSONObject();
        q.put("id", c.getInt(0));
        q.put("text", c.getString(1));
        q.put("answer", c.getString(2));
        q.put("category", c.getString(3));
        q.put("source", c.getString(4));
        q.put("reference", c.getString(5));
        return q;
    }

    public synchronized JSONObject nextQuestion(String category) throws Exception {
        if (category != null && (category.length() < 1 || category.length() > 60))
            throw new IllegalArgumentException("التصنيف غير صحيح");
        String sql = "SELECT id,text,answer,category,source,reference FROM questions WHERE used=0";
        String[] args = category == null ? null : new String[]{category};
        if (category != null) sql += " AND category=?";
        sql += " ORDER BY RANDOM() LIMIT 1";
        try (Cursor c = getReadableDatabase().rawQuery(sql, args)) {
            if (!c.moveToFirst())
                throw new IllegalStateException(category == null
                        ? "مفيش أسئلة جديدة. صفّر حالة الأسئلة"
                        : "مفيش أسئلة جديدة في النوع المختار");
            selectedQuestion = question(c);
        }
        getWritableDatabase().execSQL("UPDATE questions SET used=1 WHERE id=?",
                new Object[]{selectedQuestion.getInt("id")});
        return selectedQuestion;
    }

    public synchronized void resetQuestionUsage() {
        getWritableDatabase().execSQL("UPDATE questions SET used=0");
        selectedQuestion = null;
    }

    private static String field(JSONObject q, String name, int max, boolean required) throws Exception {
        Object value = q.opt(name);
        if ((value == null || value == JSONObject.NULL) && !required) return "";
        if (!(value instanceof String)) throw new IllegalArgumentException(name + " لازم يكون نص");
        String s = ((String) value).trim();
        if ((required && s.isEmpty()) || s.length() > max)
            throw new IllegalArgumentException("الحقل " + name + " فاضي أو طويل");
        return s;
    }

    /** Validate fully before transaction, then replace atomically. */
    public synchronized void replaceQuestions(JSONArray rows) throws Exception {
        if (rows == null || rows.length() < 1 || rows.length() > 1000)
            throw new IllegalArgumentException("ملف الأسئلة لازم يحتوي من 1 إلى 1000 سؤال");
        Set<String> seen = new HashSet<>();
        JSONArray normalized = new JSONArray();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject item = rows.optJSONObject(i);
            if (item == null) throw new IllegalArgumentException("تنسيق السؤال رقم " + (i + 1) + " غلط");
            String text = field(item, "text", 400, true);
            String answer = field(item, "answer", 400, true);
            String category = field(item, "category", 60, true);
            String source = field(item, "source", 120, false);
            String reference = field(item, "reference", 250, false);
            String key = Normalizer.normalize(text, Normalizer.Form.NFKC)
                    .toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
            if (!seen.add(key)) throw new IllegalArgumentException("سؤال متكرر رقم " + (i + 1));
            normalized.put(new JSONObject().put("text", text).put("answer", answer)
                    .put("category", category).put("source", source).put("reference", reference));
        }
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("questions", null, null);
            for (int i = 0; i < normalized.length(); i++) {
                JSONObject q = normalized.getJSONObject(i);
                ContentValues v = new ContentValues();
                for (String key : new String[]{"text", "answer", "category", "source", "reference"})
                    v.put(key, q.getString(key));
                db.insertOrThrow("questions", null, v);
            }
            db.setTransactionSuccessful();
            selectedQuestion = null;
        } finally {
            db.endTransaction();
        }
    }
}
