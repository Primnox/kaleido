package app.kaleido.player

import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import org.json.JSONArray
import org.json.JSONObject
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout
import java.util.Locale
import kotlin.math.roundToInt

// The Android twin of engine/src/main.rs: the same JSON commands in and the same events out, so
// src/core/engine.js runs unchanged. The one difference is the picture: libVLC draws it onto a
// TextureView under the see-through page instead of sending frames to it.
class Engine(private val act: MainActivity, private val layout: VLCVideoLayout) {
    private val libVLC = LibVLC(act, arrayListOf("--audio-time-stretch").apply { if (BuildConfig.DEBUG) add("-vv") })
    val player = MediaPlayer(libVLC)
    private val main = Handler(Looper.getMainLooper())
    private var loaded = false
    private var volume = 100
    private var muted = false
    private var tracksDirty = false
    private var lastBuffering = -1
    private var lastTick = Pair(Long.MIN_VALUE, Long.MIN_VALUE)

    // Size of the picture as libVLC decodes it, once known.
    var videoWidth = 0
        private set
    var videoHeight = 0
        private set
    private var sar = 1.0
    private var aspect = "auto"

    init {
        // Subtitles on, and a TextureView rather than a SurfaceView so the picture can be read back
        // for the held pause and the scene colour.
        player.attachViews(layout, null, true, true)
        // libVLC does not always notice its view resizing (picture in picture, rotation), and then
        // draws for the old size. Tell it every time.
        layout.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob ->
            if (r - l != or - ol || b - t != ob - ot) {
                player.vlcVout.setWindowSize(r - l, b - t)
                player.updateVideoSurfaces()
            }
        }
        player.setEventListener { onEvent(it) }
        main.post(object : Runnable {
            override fun run() {
                tick()
                main.postDelayed(this, 200)
            }
        })
    }

    // Events go over as text, exactly what the desktop engine writes to its WebSocket.
    private fun emit(v: JSONObject) = act.js("__kaleido.engineEvent(${JSONObject.quote(v.toString())})")

    private fun state(s: String) = emit(JSONObject().put("ev", "state").put("state", s))

    private fun onEvent(e: MediaPlayer.Event) {
        when (e.type) {
            MediaPlayer.Event.Opening -> state("opening")
            MediaPlayer.Event.Buffering -> {
                // Only the edges (started buffering, done buffering), like the desktop engine.
                val pct = e.buffering.roundToInt()
                if (lastBuffering == -1 || (pct >= 100) != (lastBuffering >= 100)) {
                    emit(JSONObject().put("ev", "buffering").put("value", pct))
                }
                lastBuffering = pct
            }
            MediaPlayer.Event.Playing -> { state("playing"); tracksDirty = true; act.onPlaying(true) }
            MediaPlayer.Event.Paused -> { state("paused"); act.onPlaying(false) }
            MediaPlayer.Event.Stopped -> { state("stopped"); act.onPlaying(false) }
            MediaPlayer.Event.EndReached -> { state("ended"); act.onPlaying(false) }
            MediaPlayer.Event.EncounteredError -> {
                emit(JSONObject().put("ev", "state").put("state", "error").put("message", "VLC could not play this."))
                act.onPlaying(false)
            }
            MediaPlayer.Event.LengthChanged -> emit(JSONObject().put("ev", "length").put("length", e.lengthChanged))
            MediaPlayer.Event.Vout -> {
                tracksDirty = true
                if (e.voutCount > 0) emitFormat() else emit(JSONObject().put("ev", "format").put("width", 0).put("height", 0))
            }
            MediaPlayer.Event.ESAdded, MediaPlayer.Event.ESDeleted, MediaPlayer.Event.ESSelected -> tracksDirty = true
        }
    }

    private fun emitFormat() {
        val v = videoTrack() ?: return
        videoWidth = v.width
        videoHeight = v.height
        sar = if (v.sarNum > 0 && v.sarDen > 0) v.sarNum.toDouble() / v.sarDen else 1.0
        emit(JSONObject().put("ev", "format").put("width", v.width).put("height", v.height)
            .put("sourceWidth", v.width).put("sourceHeight", v.height))
        act.onVideoSize(v.width, v.height, if (v.sarDen > 0) v.sarNum.toDouble() / v.sarDen else 1.0)
    }

    private fun videoTrack(): IMedia.VideoTrack? {
        val m = player.media ?: return null
        try {
            for (i in 0 until m.trackCount) {
                val t = m.getTrack(i)
                if (t is IMedia.VideoTrack && t.width > 0) return t
            }
            return null
        } finally {
            m.release()
        }
    }

    // Time ticks a few times a second; the UI interpolates between them.
    private fun tick() {
        if (!loaded) return
        val now = Pair(player.time, player.length)
        if (now != lastTick) {
            lastTick = now
            emit(JSONObject().put("ev", "time").put("time", now.first).put("length", now.second))
        }
        if (tracksDirty) {
            tracksDirty = false
            emit(tracksInfo())
        }
    }

    fun hello() {
        val bands = JSONArray()
        for (i in 0 until MediaPlayer.Equalizer.getBandCount()) bands.put(MediaPlayer.Equalizer.getBandFrequency(i).toDouble())
        val presets = JSONArray()
        for (i in 0 until MediaPlayer.Equalizer.getPresetCount()) {
            val eq = MediaPlayer.Equalizer.createFromPreset(i) ?: continue
            val amps = JSONArray()
            for (b in 0 until bands.length()) amps.put(eq.getAmp(b).toDouble())
            presets.put(JSONObject().put("index", i).put("name", MediaPlayer.Equalizer.getPresetName(i))
                .put("preamp", eq.preAmp.toDouble()).put("bands", amps))
        }
        emit(JSONObject().put("ev", "hello").put("version", "${BuildConfig.LIBVLC_VERSION} (Android)")
            .put("bands", bands).put("presets", presets))
        if (loaded) tracksDirty = true
    }

    private fun tracksInfo(): JSONObject {
        val audio = JSONArray()
        player.audioTracks?.forEach { audio.put(JSONObject().put("id", it.id).put("name", it.name ?: "")) }
        val spu = JSONArray()
        player.spuTracks?.forEach { spu.put(JSONObject().put("id", it.id).put("name", it.name ?: "")) }
        val chapters = JSONArray()
        player.getChapters(-1)?.forEach {
            chapters.put(JSONObject().put("time", it.timeOffset).put("duration", it.duration).put("name", (it.name ?: "").trim()))
        }
        var video: Any = JSONObject.NULL
        val audioInfo = JSONArray()
        val subInfo = JSONArray()
        val meta = JSONObject()
        player.media?.let { m ->
            for (i in 0 until m.trackCount) {
                when (val t = m.getTrack(i)) {
                    is IMedia.VideoTrack -> if (video == JSONObject.NULL) {
                        video = JSONObject().put("codec", t.codec ?: "").put("width", t.width).put("height", t.height)
                            .put("sarNum", t.sarNum).put("sarDen", t.sarDen)
                            .put("fps", if (t.frameRateDen > 0) t.frameRateNum.toDouble() / t.frameRateDen else 0.0)
                            .put("bitrate", t.bitrate)
                    }
                    is IMedia.AudioTrack -> audioInfo.put(JSONObject().put("id", t.id).put("codec", t.codec ?: "")
                        .put("channels", t.channels).put("rate", t.rate)
                        .put("language", t.language ?: "").put("description", t.description ?: ""))
                    is IMedia.SubtitleTrack -> subInfo.put(JSONObject().put("id", t.id).put("codec", t.codec ?: "").put("language", t.language ?: ""))
                }
            }
            // Same meta slots as libvlc_meta_t: title, artist, genre, album, date, now playing, artwork.
            for ((key, idx) in listOf("title" to 0, "artist" to 1, "genre" to 2, "album" to 4, "date" to 8, "nowPlaying" to 12, "artwork" to 15)) {
                m.getMeta(idx)?.takeIf { it.isNotEmpty() }?.let { meta.put(key, it) }
            }
            m.release()
        }
        return JSONObject().put("ev", "tracks").put("audio", audio).put("spu", spu)
            .put("audioTrack", player.audioTrack).put("spuTrack", player.spuTrack)
            .put("chapters", chapters).put("chapter", player.chapter)
            .put("video", video).put("audioInfo", audioInfo).put("subtitleInfo", subInfo).put("meta", meta)
    }

    // ---------- commands from the UI ----------

    fun handle(text: String) {
        val v = try { JSONObject(text) } catch (e: Exception) { return }
        when (v.optString("cmd")) {
            "open" -> open(v)
            "play" -> player.play()
            "pause" -> player.pause()
            "toggle" -> if (player.isPlaying) player.pause() else player.play()
            "stop" -> { loaded = false; player.stop(); videoWidth = 0; videoHeight = 0; act.onStopped() }
            "seek" -> player.setTime((v.optDouble("time", 0.0) * 1000).toLong())
            "rate" -> player.setRate(v.optDouble("value", 1.0).toFloat())
            "volume" -> {
                volume = v.optDouble("value", 100.0).roundToInt().coerceIn(0, 200)
                if (!muted) player.setVolume(volume)
            }
            // libVLC for Android has no mute switch, so mute is volume zero.
            "mute" -> { muted = v.optBoolean("value"); player.setVolume(if (muted) 0 else volume) }
            "audioTrack" -> { player.setAudioTrack(v.optInt("id", -1)); tracksDirty = true }
            "spuTrack" -> { player.setSpuTrack(v.optInt("id", -1)); tracksDirty = true }
            "spuDelay" -> player.setSpuDelay((v.optDouble("ms", 0.0) * 1000).toLong())
            "audioDelay" -> player.setAudioDelay((v.optDouble("ms", 0.0) * 1000).toLong())
            "addSubtitle" -> v.optString("uri").takeIf { it.isNotEmpty() }?.let {
                // 0 is IMedia.Slave.Type.Subtitle.
                player.addSlave(0, Uri.parse(it), true)
                tracksDirty = true
            }
            "chapter" -> player.setChapter(v.optInt("index", 0))
            "eq" -> setEq(v)
            "snapshot" -> act.saveSnapshot(v.optString("path"))
            "tracks" -> tracksDirty = true
        }
    }

    private fun open(v: JSONObject) {
        val path = v.optString("path")
        val media = if (path.contains("://")) Media(libVLC, Uri.parse(path)) else Media(libVLC, path)
        media.setHWDecoderEnabled(true, false)
        v.optJSONArray("options")?.let { o ->
            for (i in 0 until o.length()) media.addOption(":" + o.getString(i).trimStart(':'))
        }
        val start = v.optDouble("start", 0.0)
        if (start > 0) media.addOption(String.format(Locale.US, ":start-time=%.3f", start))
        if (v.optBoolean("paused")) media.addOption(":start-paused")
        player.media = media
        media.release()
        player.play()
        loaded = true
        tracksDirty = true
        lastBuffering = -1
        videoWidth = 0
        videoHeight = 0
    }

    private fun setEq(v: JSONObject) {
        if (!v.optBoolean("enabled")) {
            player.setEqualizer(null)
            return
        }
        val eq = MediaPlayer.Equalizer.create()
        eq.setPreAmp(v.optDouble("preamp", 0.0).toFloat())
        v.optJSONArray("bands")?.let { b -> for (i in 0 until b.length()) eq.setAmp(i, b.optDouble(i, 0.0).toFloat()) }
        player.setEqualizer(eq)
    }

    // Aspect and zoom, the same choices as the desktop's WebGL surface.
    fun setView(aspect: String, zoom: Double) {
        this.aspect = aspect
        when (aspect) {
            "fill" -> { player.aspectRatio = null; player.videoScale = MediaPlayer.ScaleType.SURFACE_FILL }
            "crop" -> { player.aspectRatio = null; player.videoScale = MediaPlayer.ScaleType.SURFACE_FIT_SCREEN }
            "auto", "" -> { player.aspectRatio = null; player.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT }
            else -> {
                player.videoScale = MediaPlayer.ScaleType.SURFACE_BEST_FIT
                player.aspectRatio = if (aspect == "2.39:1") "239:100" else aspect
            }
        }
        layout.scaleX = zoom.toFloat()
        layout.scaleY = zoom.toFloat()
    }

    // The picture as it is on screen right now, or null when there is none. The TextureView fills
    // the stage and VLC letterboxes or pillarboxes inside it, so the bars around it are cut away.
    fun grab(maxWidth: Int): Bitmap? {
        val tv = findTexture(layout) ?: return null
        if (!tv.isAvailable || tv.width == 0 || tv.height == 0) return null
        val viewAr = tv.width.toDouble() / tv.height
        val picAr = pictureAspect() ?: viewAr
        val pw = if (picAr > viewAr) 1.0 else picAr / viewAr
        val ph = if (picAr > viewAr) viewAr / picAr else 1.0
        val scale = minOf(1.0, maxWidth / (tv.width * pw))
        val bw = (tv.width * scale).roundToInt().coerceAtLeast(2)
        val bh = (tv.height * scale).roundToInt().coerceAtLeast(2)
        val full = tv.getBitmap(bw, bh) ?: return null
        if (pw > 0.995 && ph > 0.995) return full
        val cw = (bw * pw).roundToInt().coerceIn(1, bw)
        val ch = (bh * ph).roundToInt().coerceIn(1, bh)
        return Bitmap.createBitmap(full, (bw - cw) / 2, (bh - ch) / 2, cw, ch)
    }

    // Shape of the picture as VLC lays it out; null when it fills the whole view.
    private fun pictureAspect(): Double? = when (aspect) {
        "fill", "crop" -> null
        "auto", "" -> if (videoWidth > 0 && videoHeight > 0) videoWidth * sar / videoHeight else null
        else -> aspect.split(':').let { p -> p.getOrNull(0)?.toDoubleOrNull()?.div(p.getOrNull(1)?.toDoubleOrNull() ?: 1.0) }
    }

    private fun findTexture(v: View): TextureView? {
        if (v is TextureView && v.visibility == View.VISIBLE) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) findTexture(v.getChildAt(i))?.let { return it }
        return null
    }

    fun hasVideo() = loaded && videoWidth > 0

    fun release() {
        player.stop()
        player.detachViews()
        player.release()
        libVLC.release()
    }
}
