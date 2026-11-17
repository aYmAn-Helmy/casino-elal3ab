package com.ayman.casinoelal3ab;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.content.SharedPreferences;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.URI;

public final class MainActivity extends Activity {
    private static final String PREFS = "casino-lan";
    private static final String PREF_SERVER = "server-address";
    private WebView gameView;
    private LinearLayout main;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(13, 20, 35));
        getWindow().setNavigationBarColor(Color.rgb(13, 20, 35));
        String address = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_SERVER, "");
        if (address.isEmpty()) showSetup("");
        else showGame(address);
    }

    private int dip(float value) {
        return (int)(value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private GradientDrawable panelColor(int color, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dip(radius));
        return d;
    }

    private LinearLayout newRoot() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(14, 21, 37));
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        main = root;
        setContentView(root);
        return root;
    }

    private TextView label(String value, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private void showSetup(String initial) {
        if (gameView != null) {
            gameView.stopLoading();
            gameView.destroy();
            gameView = null;
        }
        LinearLayout root = newRoot();
        root.setPadding(dip(22), dip(70), dip(22), dip(20));
        TextView icon = label("🔔", 68, Color.WHITE);
        root.addView(icon, new LinearLayout.LayoutParams(-1, dip(115)));
        TextView title = label("كازينو الألعاب", 28, Color.WHITE);
        title.setTypeface(null, Typeface.BOLD);
        root.addView(title);
        TextView sub = label("اتصل بسيرفر CasaOS على نفس شبكة Wi-Fi", 16, Color.rgb(169, 185, 212));
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(-1, -2);
        textParams.setMargins(0, dip(12), 0, dip(34));
        root.addView(sub, textParams);

        final EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setTextSize(18);
        field.setTextColor(Color.WHITE);
        field.setHintTextColor(Color.LTGRAY);
        field.setHint("192.168.1.100:3000");
        field.setText(initial);
        field.setSelectAllOnFocus(true);
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        field.setBackground(panelColor(Color.rgb(31, 46, 69), 14));
        field.setPadding(dip(17), dip(12), dip(17), dip(12));
        root.addView(field, new LinearLayout.LayoutParams(-1, dip(54)));
        Button connect = new Button(this);
        connect.setText("اتصل وابدأ اللعب");
        connect.setAllCaps(false);
        connect.setTextSize(18);
        connect.setTextColor(Color.WHITE);
        connect.setBackground(panelColor(Color.rgb(208, 36, 65), 13));
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(-1, dip(58));
        actionParams.setMargins(0, dip(18), 0, 0);
        root.addView(connect, actionParams);
        connect.setOnClickListener(v -> {
            String hostPort = field.getText().toString().trim();
            try {
                if (!hostPort.startsWith("http://") && !hostPort.startsWith("https://")) {
                    hostPort = "http://" + hostPort;
                }
                URI uri = new URI(hostPort);
                if (!"http".equals(uri.getScheme()) || uri.getHost() == null ||
                        (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath())) ||
                        uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                    throw new IllegalArgumentException("عنوان السيرفر غير صحيح");
                }
                int port = uri.getPort();
                if (port < -1 || port > 65535 || port == 0) throw new IllegalArgumentException("منفذ غلط");
                String value = uri.getHost() + (port == -1 ? "" : ":" + port);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_SERVER, value).apply();
                ((InputMethodManager)getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(field.getWindowToken(), 0);
                showGame(value);
            } catch (Exception error) {
                Toast.makeText(this, "اكتب IP السيرفر ورقم المنفذ، مثال: 192.168.1.100:3000", Toast.LENGTH_LONG).show();
            }
        });
        TextView help = label("هتلاقي عنوان السيرفر في آخر رسالة من سكربت تثبيت CasaOS. أول مرة لازم تدخل IP بس.", 14, Color.rgb(169, 185, 212));
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, -2);
        hp.setMargins(0, dip(27), 0, 0);
        root.addView(help, hp);
    }

    private void showGame(String address) {
        LinearLayout root = newRoot();
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(Color.rgb(26, 39, 61));
        header.setPadding(dip(12), dip(6), dip(12), dip(6));
        TextView title = label("🔔 كازينو الألعاب", 16, Color.WHITE);
        title.setTypeface(null, Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, dip(45), 1));
        Button change = new Button(this);
        change.setText("تغيير السيرفر");
        change.setTextSize(12);
        change.setAllCaps(false);
        change.setOnClickListener(v -> showSetup(address));
        header.addView(change, new LinearLayout.LayoutParams(-2, dip(47)));
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));

        WebView view = new WebView(this);
        gameView = view;
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                        "مش قادر أوصل للسيرفر؛ راجع IP والواي فاي واضغط رجوع لتغيير العنوان",
                        Toast.LENGTH_LONG).show();
                }
            }
        });
        root.addView(view, new LinearLayout.LayoutParams(-1, 0, 1));
        view.loadUrl("http://" + address + "/play");
    }

    @Override
    public void onBackPressed() {
        if (gameView != null && gameView.canGoBack()) gameView.goBack();
        else if (gameView != null) showSetup(getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_SERVER, ""));
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (gameView != null) {
            gameView.stopLoading();
            gameView.destroy();
            gameView = null;
        }
        super.onDestroy();
    }
}
