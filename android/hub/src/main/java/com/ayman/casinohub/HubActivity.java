package com.ayman.casinohub;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.net.InetAddress;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/** Host dashboard + QR join address. The hub server runs independently in HubService. */
public final class HubActivity extends Activity {
    private static final String PREFS = "casino-hub-settings";
    private static final String PIN_KEY = "host-pin";
    private static final int BG = Color.rgb(14, 21, 37);
    private static final int PANEL = Color.rgb(26, 39, 61);
    private static final int BLUE = Color.rgb(52, 105, 187);
    private static final int MUTED = Color.rgb(179, 194, 217);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ScrollView dashboard;
    private WebView adminView;
    private LinearLayout root;
    private TextView status;
    private TextView addresses;
    private ImageView qr;
    private Button openAdmin;
    private String lastDisplayedUrl = "";
    private boolean showingAdmin = false;

    public static String getOrMakeHostPin(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        String pin = preferences.getString(PIN_KEY, "");
        if (pin.length() >= 16) return pin;
        byte[] random = new byte[16];
        new SecureRandom().nextBytes(random);
        StringBuilder result = new StringBuilder(random.length * 2);
        for (byte b : random) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        pin = result.toString();
        preferences.edit().putString(PIN_KEY, pin).apply();
        return pin;
    }

    private int px(float dp) {
        return (int) (dp * getResources().getDisplayMetrics().density + .5f);
    }

    private GradientDrawable background(int color) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(px(14));
        return g;
    }

    private TextView label(String value, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        t.setPadding(px(8), px(7), px(8), px(7));
        return t;
    }

    private void addText(LinearLayout layout, String value, int sp, int color) {
        layout.addView(label(value, sp, color));
    }

    private Button button(String title, int color, LinearLayout container, Runnable action) {
        Button b = new Button(this);
        b.setText(title);
        b.setTextColor(Color.WHITE);
        b.setTextSize(16);
        b.setAllCaps(false);
        b.setBackground(background(color));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, px(54));
        lp.setMargins(0, px(6), 0, px(6));
        container.addView(b, lp);
        b.setOnClickListener(v -> action.run());
        return b;
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9);
        }
        makeDashboard();
    }

    private void makeDashboard() {
        showingAdmin = false;
        if (adminView != null) {
            adminView.stopLoading();
            adminView.destroy();
            adminView = null;
        }
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(BG);
        setContentView(root);

        dashboard = new ScrollView(this);
        dashboard.setFillViewport(true);
        root.addView(dashboard, new LinearLayout.LayoutParams(-1, -1));
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(px(20), px(25), px(20), px(30));
        dashboard.addView(content);
        addText(content, "🎮 كازينو الألعاب", 30, Color.WHITE);
        addText(content, "الموبايل ده هو الـ Hub والسيرفر — من غير CasaOS أو إنترنت", 15, MUTED);
        status = label("جاري التحقق من السيرفر...", 17, Color.WHITE);
        status.setBackground(background(PANEL));
        content.addView(status, new LinearLayout.LayoutParams(-1, px(60)));

        button("▶ تشغيل السيرفر على الموبايل", Color.rgb(19, 131, 89), content, this::startHub);
        button("⏹ إيقاف السيرفر", Color.rgb(163, 53, 77), content, this::stopHub);
        button("⚙ فتح إعدادات الهوتسبوت", BLUE, content, () -> {
            try { startActivity(new Intent("android.settings.TETHER_SETTINGS")); }
            catch (Exception ignored) {
                startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
            }
        });

        addText(content, "📡 روابط دخول اللاعبين", 22, Color.WHITE);
        addresses = label("وصّل الموبايلات بنفس الواي فاي أو شغّل الهوتسبوت", 15, MUTED);
        addresses.setTextIsSelectable(true);
        addresses.setBackground(background(PANEL));
        content.addView(addresses);
        button("🔄 تحديث عناوين الشبكة", BLUE, content, this::refresh);

        qr = new ImageView(this);
        LinearLayout.LayoutParams qrParams = new LinearLayout.LayoutParams(px(245), px(245));
        qrParams.gravity = Gravity.CENTER_HORIZONTAL;
        qrParams.setMargins(0, px(10), 0, px(10));
        content.addView(qr, qrParams);
        button("📋 نسخ رابط دخول اللاعبين", BLUE, content, () -> {
            if (lastDisplayedUrl.isEmpty()) {
                Toast.makeText(this, "وصّل الشبكة الأول", Toast.LENGTH_SHORT).show();
                return;
            }
            copy("رابط اللاعبين", lastDisplayedUrl);
        });

        addText(content, "🔐 رقم دخول المذيع (خاص بيك)", 19, Color.WHITE);
        String pin = getOrMakeHostPin(this);
        TextView secret = label(pin, 17, Color.rgb(255, 206, 87));
        secret.setTextIsSelectable(true);
        secret.setBackground(background(PANEL));
        content.addView(secret);
        button("📋 نسخ رمز المذيع", BLUE, content, () -> copy("رمز المذيع", pin));
        openAdmin = button("🎤 افتح لوحة تحكم المذيع", Color.rgb(19, 131, 89), content, this::showAdmin);
        addText(content, "🌐 اللاعبون يدخلوا من المتصفح أو APK اللاعب. شاشة التلفزيون: نفس الرابط مع /screen.", 14, MUTED);
        addText(content, "⚠ خليك فاتح السيرفر من الإشعار، وسيب الموبايل على الشاحن. بعض الهواتف بتفصل الهوتسبوت أو تقيّد التطبيقات في الخلفية.", 13, MUTED);
        refresh();
        handler.removeCallbacks(refreshTask);
        handler.postDelayed(refreshTask, 2000);
    }

    private void copy(String description, String value) {
        ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        manager.setPrimaryClip(ClipData.newPlainText(description, value));
        Toast.makeText(this, "تم النسخ", Toast.LENGTH_SHORT).show();
    }

    private static final class Address {
        final String name;
        final String ip;
        Address(String name, String ip) { this.name = name; this.ip = ip; }
        int rank() {
            String n = name.toLowerCase(java.util.Locale.ROOT);
            if (n.startsWith("wlan") || n.startsWith("wifi") || n.startsWith("ap") ||
                    n.startsWith("swlan")) return 0;
            if (n.startsWith("eth")) return 1;
            return 2;
        }
    }

    private static List<Address> findLanAddresses() {
        List<Address> list = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> all = NetworkInterface.getNetworkInterfaces();
            while (all != null && all.hasMoreElements()) {
                NetworkInterface net = all.nextElement();
                if (!net.isUp() || net.isLoopback() || net.isVirtual()) continue;
                String name = net.getName().toLowerCase(java.util.Locale.ROOT);
                // Cellular/VPN interfaces are not normally reachable by local players.
                if (name.startsWith("rmnet") || name.startsWith("ccmni") ||
                        name.startsWith("tun") || name.startsWith("pdp") ||
                        name.startsWith("v4-") || name.startsWith("clat")) continue;
                for (Enumeration<InetAddress> addrs = net.getInetAddresses(); addrs.hasMoreElements();) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && addr.isSiteLocalAddress() &&
                            !addr.isLoopbackAddress()) {
                        list.add(new Address(net.getName(), addr.getHostAddress()));
                    }
                }
            }
        } catch (Exception ignored) {}
        Collections.sort(list, (a, b) -> Integer.compare(a.rank(), b.rank()));
        return list;
    }

    private static Bitmap qrBitmap(String url) throws Exception {
        BitMatrix bits = new MultiFormatWriter().encode(url, BarcodeFormat.QR_CODE, 440, 440);
        Bitmap bitmap = Bitmap.createBitmap(440, 440, Bitmap.Config.ARGB_8888);
        for (int y = 0; y < 440; y++) {
            for (int x = 0; x < 440; x++) {
                bitmap.setPixel(x, y, bits.get(x, y) ? Color.BLACK : Color.WHITE);
            }
        }
        return bitmap;
    }

    private void refresh() {
        if (showingAdmin || status == null) return;
        status.setText(HubService.running ? "🟢 السيرفر شغال — بورت 3000" :
                HubService.lastError.isEmpty() ? "⚪ السيرفر متوقف" :
                        "🔴 تعذر بدء السيرفر: " + HubService.lastError);
        if (openAdmin != null) openAdmin.setEnabled(HubService.running);
        List<Address> addrs = findLanAddresses();
        if (addrs.isEmpty()) {
            addresses.setText("مش ظاهر IP للشبكة. افتح الهوتسبوت من الإعدادات أو وصّل Wi-Fi، وبعدين اضغط تحديث.");
            lastDisplayedUrl = "";
            qr.setImageDrawable(null);
            return;
        }
        StringBuilder text = new StringBuilder();
        for (Address address : addrs) {
            text.append("http://").append(address.ip).append(":3000/play")
                    .append(" (").append(address.name).append(")\n");
        }
        addresses.setText(text.toString().trim());
        String newUrl = "http://" + addrs.get(0).ip + ":3000/play";
        if (!newUrl.equals(lastDisplayedUrl)) {
            lastDisplayedUrl = newUrl;
            try { qr.setImageBitmap(qrBitmap(newUrl)); }
            catch (Exception e) { qr.setImageDrawable(null); }
        }
    }

    private void startHub() {
        if (HubService.running) { refresh(); return; }
        try {
            Intent start = new Intent(this, HubService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(start);
            else startService(start);
            status.setText("⏳ بنشغّل السيرفر والـ1000 سؤال...");
        } catch (Exception e) {
            Toast.makeText(this, "مش قادر أشغل السيرفر: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void stopHub() {
        Intent stop = new Intent(this, HubService.class);
        stop.setAction(HubService.STOP);
        startService(stop);
        handler.postDelayed(this::refresh, 500);
    }

    private void showAdmin() {
        if (!HubService.running) {
            Toast.makeText(this, "شغّل السيرفر الأول", Toast.LENGTH_SHORT).show();
            return;
        }
        showingAdmin = true;
        handler.removeCallbacks(refreshTask);
        root.removeAllViews();
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(px(10), px(6), px(10), px(6));
        header.setBackgroundColor(PANEL);
        Button back = new Button(this);
        back.setText("↩ رجوع للـHub");
        back.setOnClickListener(v -> makeDashboard());
        header.addView(back);
        TextView title = label("🎤 لوحة المذيع", 18, Color.WHITE);
        title.setTypeface(null, Typeface.BOLD);
        header.addView(title);
        root.addView(header);
        adminView = new WebView(this);
        adminView.getSettings().setJavaScriptEnabled(true);
        adminView.getSettings().setDomStorageEnabled(true);
        adminView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        adminView.setWebChromeClient(new WebChromeClient());
        adminView.setWebViewClient(new WebViewClient());
        root.addView(adminView, new LinearLayout.LayoutParams(-1, 0, 1));
        adminView.loadUrl("http://127.0.0.1:3000/admin");
    }

    private final Runnable refreshTask = new Runnable() {
        @Override public void run() {
            if (!isFinishing() && !showingAdmin) {
                refresh();
                handler.postDelayed(this, 2500);
            }
        }
    };

    @Override public void onBackPressed() {
        if (showingAdmin) makeDashboard();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        handler.removeCallbacks(refreshTask);
        if (adminView != null) {
            adminView.stopLoading();
            adminView.destroy();
            adminView = null;
        }
        super.onDestroy();
    }
}
