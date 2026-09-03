package io.github.hdalmino0011.classconnect;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String TAG = "ClassConnect-AppUpdate";
    private static final String PREFS_NAME = "ClassConnectUpdatePrefs";
    private static final String KEY_JUST_UPDATED = "just_updated";

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            Context context = getContext();
            PackageInfo pInfo;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pInfo = context.getPackageManager().getPackageInfo(
                    context.getPackageName(),
                    PackageManager.PackageInfoFlags.of(0)
                );
            } else {
                pInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            }

            long versionCode = PackageInfoCompat.getLongVersionCode(pInfo);
            String versionName = pInfo.versionName != null ? pInfo.versionName : "1.0.0";

            JSObject ret = new JSObject();
            ret.put("versionName", versionName);
            ret.put("versionCode", (int) versionCode);
            ret.put("packageName", context.getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error fetching app version", e);
            call.reject("Failed to get app version: " + e.getMessage());
        }
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                boolean canInstall = getContext().getPackageManager().canRequestPackageInstalls();
                ret.put("canInstall", canInstall);
            } else {
                ret.put("canInstall", true);
            }
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("canInstall", true);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Could not open unknown app sources settings", e);
            call.reject("Could not open settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String apkUrl = call.getString("url");
        if (apkUrl == null || apkUrl.trim().isEmpty()) {
            call.reject("APK URL is required");
            return;
        }

        // Check unknown sources permission first on Android 8.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                JSObject permRequired = new JSObject();
                permRequired.put("status", "permission_required");
                permRequired.put("message", "Permission required to install updates from within ClassConnect");
                notifyListeners("downloadProgress", permRequired);

                Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                permIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
                permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(permIntent);

                call.reject("PERMISSION_REQUIRED");
                return;
            }
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            FileOutputStream output = null;

            try {
                // Notify start
                JSObject startMsg = new JSObject();
                startMsg.put("status", "connecting");
                startMsg.put("percent", 0);
                notifyListeners("downloadProgress", startMsg);

                String currentUrl = apkUrl;
                int redirects = 0;
                boolean connected = false;

                // Handle HTTP redirects (e.g. GitHub releases to CDN/S3)
                while (!connected && redirects < 8) {
                    URL url = new URL(currentUrl);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setRequestProperty("User-Agent", "ClassConnect-AppUpdate/1.0");
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    connection.setInstanceFollowRedirects(true);
                    connection.connect();

                    int responseCode = connection.getResponseCode();
                    if (responseCode == HttpURLConnection.HTTP_MOVED_PERM ||
                        responseCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                        responseCode == HttpURLConnection.HTTP_SEE_OTHER ||
                        responseCode == 307 || responseCode == 308) {
                        String newUrl = connection.getHeaderField("Location");
                        if (newUrl != null && !newUrl.isEmpty()) {
                            currentUrl = newUrl;
                            redirects++;
                            connection.disconnect();
                            continue;
                        }
                    }

                    if (responseCode != HttpURLConnection.HTTP_OK) {
                        throw new Exception("Server returned HTTP " + responseCode + " " + connection.getResponseMessage());
                    }
                    connected = true;
                }

                int fileLength = connection.getContentLength();
                input = new BufferedInputStream(connection.getInputStream(), 16384);

                File cacheDir = getContext().getExternalCacheDir() != null
                    ? getContext().getExternalCacheDir()
                    : getContext().getCacheDir();

                File apkFile = new File(cacheDir, "classconnect-update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                output = new FileOutputStream(apkFile);

                byte[] data = new byte[8192];
                long total = 0;
                int count;
                long lastProgressTime = 0;

                while ((count = input.read(data)) != -1) {
                    total += count;
                    output.write(data, 0, count);

                    long now = System.currentTimeMillis();
                    if (fileLength > 0 && (now - lastProgressTime > 150 || total == fileLength)) {
                        lastProgressTime = now;
                        int percent = (int) (total * 100 / fileLength);
                        JSObject progress = new JSObject();
                        progress.put("status", "downloading");
                        progress.put("percent", percent);
                        progress.put("bytesRead", total);
                        progress.put("totalBytes", fileLength);
                        notifyListeners("downloadProgress", progress);
                    }
                }

                output.flush();
                output.close();
                output = null;
                input.close();
                input = null;

                // Download completed
                JSObject completeMsg = new JSObject();
                completeMsg.put("status", "installing");
                completeMsg.put("percent", 100);
                completeMsg.put("fileSize", apkFile.length());
                notifyListeners("downloadProgress", completeMsg);

                // Set flag to clear cache on restart
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putBoolean(KEY_JUST_UPDATED, true).apply();

                // Trigger package installation intent
                Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
                );

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getContext().startActivity(installIntent);

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("message", "Installer opened");
                call.resolve(res);

            } catch (Exception e) {
                Log.e(TAG, "Download and install failed", e);
                JSObject errorMsg = new JSObject();
                errorMsg.put("status", "error");
                errorMsg.put("error", e.getMessage());
                notifyListeners("downloadProgress", errorMsg);
                call.reject("Download failed: " + e.getMessage());
            } finally {
                try {
                    if (output != null) output.close();
                    if (input != null) input.close();
                    if (connection != null) connection.disconnect();
                } catch (Exception ignored) {}
            }
        }).start();
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        try {
            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().clearCache(true);
                            getBridge().getWebView().clearHistory();
                            getBridge().getWebView().clearFormData();
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "WebView cache clear warning", e);
                    }
                });
            }

            deleteRecursive(getContext().getCacheDir());
            if (getContext().getExternalCacheDir() != null) {
                deleteRecursive(getContext().getExternalCacheDir());
            }

            JSObject ret = new JSObject();
            ret.put("cleared", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error clearing cache", e);
            call.reject("Failed to clear cache: " + e.getMessage());
        }
    }

    @PluginMethod
    public void restartApp(PluginCall call) {
        try {
            Context context = getContext();
            Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                context.startActivity(intent);
                call.resolve();
                Runtime.getRuntime().exit(0);
            } else {
                call.reject("Could not find launch intent for package");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error restarting app", e);
            call.reject("Failed to restart app: " + e.getMessage());
        }
    }

    @PluginMethod
    public void wasJustUpdated(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean justUpdated = prefs.getBoolean(KEY_JUST_UPDATED, false);
        if (justUpdated) {
            prefs.edit().putBoolean(KEY_JUST_UPDATED, false).apply();
            // Automatically clear WebView cache
            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().clearCache(true);
                        }
                    } catch (Exception ignored) {}
                });
            }
        }
        JSObject ret = new JSObject();
        ret.put("justUpdated", justUpdated);
        call.resolve(ret);
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
