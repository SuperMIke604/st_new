package app.stnew.termux;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

public final class PendingSendService extends Service {
    private static final String CHANNEL = "pending-chat-send";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent openApp = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification.Builder notification;
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager.class).createNotificationChannel(
                    new NotificationChannel(CHANNEL, "聊天发送", NotificationManager.IMPORTANCE_LOW));
            notification = new Notification.Builder(this, CHANNEL);
        } else {
            notification = new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
        }
        try {
            startForeground(1, notification.setSmallIcon(android.R.drawable.stat_sys_upload)
                    .setContentTitle("ST New")
                    .setContentText("正在准备发送聊天消息")
                    .setContentIntent(PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE))
                    .setOngoing(true).build());
        } catch (IllegalStateException | SecurityException error) {
            Log.w("ST New", "Android did not allow the pending send service", error);
            stopSelf(startId);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
