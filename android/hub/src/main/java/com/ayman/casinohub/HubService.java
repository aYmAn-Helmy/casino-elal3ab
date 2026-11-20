package com.ayman.casinohub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

/**
 * User-started foreground service: the phone hosts all game traffic directly.
 * It remains active when the host opens another app or locks the screen,
 * subject to the phone vendor's hotspot and battery restrictions.
 */
public final class HubService extends Service {
    public static final String STOP = "com.ayman.casinohub.STOP";
    private static final String CHANNEL = "casino_phone_hub";
    private static final int NOTIFICATION_ID = 3091;
    private static final String TAG = "CasinoHubService";

    public static volatile boolean running = false;
    public static volatile String lastError = "";

    private HubServer server;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean stopping;
    private volatile boolean starting;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL,
                    "كازينو الألعاب — السيرفر المحلي", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, HubActivity.class);
        PendingIntent target = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("🎮 كازينو الألعاب — Hub شغال")
                .setContentText("الجهاز دلوقتي هو السيرفر · نفس الواي فاي أو الهوتسبوت")
                .setOngoing(true).setContentIntent(target).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            stopping = true;
            stopSelf();
            return START_NOT_STICKY;
        }
        if (stopping) return START_NOT_STICKY;
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification());
        }
        synchronized (this) {
            if (server != null || running || starting) return START_STICKY;
            starting = true;
            lastError = "";
            new Thread(() -> {
                try {
                    String pin = HubActivity.getOrMakeHostPin(getApplicationContext());
                    HubServer candidate = new HubServer(getApplicationContext(), pin);
                    // Browser WebSockets can stay idle between quiz rounds for hours.
                    // A short socket read timeout would disconnect them repeatedly.
                    candidate.start(0, false);
                    synchronized (HubService.this) {
                        if (stopping) {
                            candidate.shutdown();
                            return;
                        }
                        server = candidate;
                        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
                        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                                "CasinoElAl3ab:LocalHub");
                        wakeLock.setReferenceCounted(false);
                        wakeLock.acquire();
                        running = true;
                        starting = false;
                    }
                    Log.i(TAG, "Phone LAN hub active on port 3000");
                } catch (Exception e) {
                    Log.e(TAG, "Hub startup failed", e);
                    lastError = e.getMessage() == null ? "تعذر تشغيل السيرفر" : e.getMessage();
                    running = false;
                    starting = false;
                    stopSelf();
                }
            }, "casino-hub-server").start();
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        stopping = true;
        starting = false;
        synchronized (this) {
            if (server != null) {
                server.shutdown();
                server = null;
            }
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
            running = false;
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
