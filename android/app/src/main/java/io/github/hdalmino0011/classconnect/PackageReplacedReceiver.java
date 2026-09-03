package io.github.hdalmino0011.classconnect;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import java.io.File;

public class PackageReplacedReceiver extends BroadcastReceiver {

    private static final String TAG = "ClassConnect-Replaced";
    private static final String PREFS_NAME = "ClassConnectUpdatePrefs";
    private static final String KEY_JUST_UPDATED = "just_updated";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            Log.d(TAG, "Application package replaced (updated). Performing post-update cleanup...");

            // Mark update flag
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean(KEY_JUST_UPDATED, true).apply();

            // Clear temporary cache
            try {
                deleteRecursive(context.getCacheDir());
                if (context.getExternalCacheDir() != null) {
                    deleteRecursive(context.getExternalCacheDir());
                }
                Log.d(TAG, "Post-update cache cleanup completed.");
            } catch (Exception e) {
                Log.w(TAG, "Cache cleanup warning", e);
            }

            // Reopen the updated application immediately so the user does not
            // remain in the package installer or an old WebView task.
            try {
                Intent launchIntent = context.getPackageManager()
                    .getLaunchIntentForPackage(context.getPackageName());
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                        Intent.FLAG_ACTIVITY_CLEAR_TOP |
                        Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    context.startActivity(launchIntent);
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not relaunch app after update", e);
            }
        }
    }

    private static void deleteRecursive(File fileOrDirectory) {
        if (fileOrDirectory != null && fileOrDirectory.exists()) {
            if (fileOrDirectory.isDirectory()) {
                File[] files = fileOrDirectory.listFiles();
                if (files != null) {
                    for (File child : files) {
                        deleteRecursive(child);
                    }
                }
            }
            fileOrDirectory.delete();
        }
    }
}
