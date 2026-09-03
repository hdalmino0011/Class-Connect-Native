package io.github.hdalmino0011.classconnect;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // If the app was updated while closed or via PackageReplacedReceiver, clear WebView cache
        SharedPreferences prefs = getSharedPreferences("ClassConnectUpdatePrefs", Context.MODE_PRIVATE);
        if (prefs.getBoolean("just_updated", false)) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().clearCache(true);
            }
        }
    }
}

