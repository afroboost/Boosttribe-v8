package pro.boosttribe.app.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Plugin natif : empêche Android de forcer le mode "communication" quand un micro WebRTC est ouvert.
 * En mode média (MODE_NORMAL + focus USAGE_MEDIA/CONTENT_TYPE_MUSIC), la musique reste en qualité HiFi
 * même micro ouvert → on peut parler par-dessus la musique proprement (au casque).
 */
@CapacitorPlugin(name = "AudioSession")
class AudioSessionPlugin : Plugin() {

    private val audioManager: AudioManager
        get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var focusRequest: AudioFocusRequest? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @PluginMethod
    fun setMode(call: PluginCall) {
        when (call.getString("mode") ?: "music") {
            "voice" -> applyVoiceMode()
            else -> {
                applyMediaMode()
                // WebRTC (WebView) repositionne parfois le mode APRÈS getUserMedia → réassert MODE_NORMAL.
                mainHandler.postDelayed({ forceNormalMode() }, 300)
                mainHandler.postDelayed({ forceNormalMode() }, 1000)
            }
        }
        call.resolve()
    }

    private fun applyMediaMode() {
        val am = audioManager
        requestMediaFocus(am)
        am.mode = AudioManager.MODE_NORMAL
        am.isSpeakerphoneOn = false // route média/HP (jamais le mode communication)
    }

    private fun applyVoiceMode() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    }

    private fun forceNormalMode() {
        val am = audioManager
        if (am.mode != AudioManager.MODE_NORMAL) am.mode = AudioManager.MODE_NORMAL
    }

    private fun requestMediaFocus(am: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(false)
                .build()
            focusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    @PluginMethod
    fun activate(call: PluginCall) {
        val am = audioManager
        requestMediaFocus(am)
        am.mode = AudioManager.MODE_NORMAL
        call.resolve()
    }

    @PluginMethod
    fun deactivate(call: PluginCall) {
        val am = audioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { am.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(null)
        }
        focusRequest = null
        call.resolve()
    }

    @PluginMethod
    fun setSpeakerphoneOn(call: PluginCall) {
        audioManager.isSpeakerphoneOn = call.getBoolean("on", false) ?: false
        call.resolve()
    }

    @PluginMethod
    fun isHeadsetConnected(call: PluginCall) {
        val ret = JSObject()
        ret.put("connected", headsetConnected())
        call.resolve(ret)
    }

    private fun headsetConnected(): Boolean {
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        for (d in devices) {
            when (d.type) {
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> return true
            }
        }
        return false
    }
}
