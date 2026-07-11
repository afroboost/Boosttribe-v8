package pro.boosttribe.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import pro.boosttribe.app.audio.AudioSessionPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AudioSessionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
