package app.kaleido.player

import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

// The page's window.host (see assets/kaleido-host.js) calls into here as KaleidoNative. Calls run
// off the UI thread and answer through __kaleido.resolve(id, value), so every desktop host call
// keeps its promise shape.
class Host(private val act: MainActivity) {
    private val io = Executors.newFixedThreadPool(2)
    private val frames = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val store = File(act.filesDir, "store.json")

    @JavascriptInterface
    fun call(id: Int, name: String, args: String) {
        val a = try { JSONArray(args) } catch (_: Exception) { JSONArray() }
        when (name) {
            "openFiles", "openFolder", "openSubtitle", "pickFolder" -> main.post { act.pick(name) { resolve(id, it) } }
            "initialFiles" -> main.post { resolve(id, act.takeInitialFiles()) }
            "win" -> main.post { resolve(id, act.win(a.optString(0), a.opt(1))) }
            "grabStill" -> main.post {
                val b = act.engine.grab(1280)
                if (b == null) resolve(id, null) else io.execute { resolve(id, Library.dataUrl(b, 88)) }
            }
            // MediaMetadataRetriever work goes one at a time, like the desktop's FFmpeg queue.
            "thumb" -> frames.execute { resolve(id, safe { act.library.thumb(a.optString(0), a.optDouble(1, 0.0), a.optInt(2, 320)) }) }
            "poster" -> frames.execute { resolve(id, safe { act.library.poster(a.optString(0), a.optDouble(1, 0.0)) }) }
            "duration" -> frames.execute { resolve(id, safe { act.library.duration(a.optString(0)) }) }
            else -> io.execute { resolve(id, safe { run(name, a) }) }
        }
    }

    private fun run(name: String, a: JSONArray): Any? = when (name) {
        "expand" -> act.library.expand(a.optJSONArray(0))
        "siblings" -> act.library.siblings(a.optString(0))
        "stat" -> act.library.stat(a.optString(0))
        "scanLibrary" -> act.library.scan(a.optJSONArray(0))
        "defaultLibrary" -> JSONArray().put(Environment.getExternalStorageDirectory().absolutePath)
        "storeGet" -> if (store.exists()) JSONObject(store.readText()) else JSONObject()
        "snapshotPath" -> {
            val safeName = a.optString(0, "snapshot").replace(Regex("[^\\w.\\- ]+"), "_").take(80)
            "$safeName ${SimpleDateFormat("yyyy-MM-dd-HH-mm-ss", Locale.US).format(Date())}.png"
        }
        else -> null
    }

    private fun <T> safe(fn: () -> T): T? = try { fn() } catch (e: Throwable) { Log.w("Kaleido", "host call failed", e); null }

    fun resolve(id: Int, v: Any?) {
        val json = toJs(v)
        main.post { act.js("__kaleido.resolve($id, $json)") }
    }

    @JavascriptInterface
    fun engine(cmd: String) { main.post { act.engine.handle(cmd) } }

    @JavascriptInterface
    fun engineConnect() { main.post { act.engine.hello() } }

    @JavascriptInterface
    fun storeSet(data: String) {
        io.execute {
            val tmp = File(store.path + ".tmp")
            tmp.writeText(data)
            tmp.renameTo(store)
        }
    }

    @JavascriptInterface
    fun placeVideo(x: Double, y: Double, w: Double, h: Double) { main.post { act.placeVideo(x, y, w, h) } }

    @JavascriptInterface
    fun setView(aspect: String, zoom: Double) { main.post { act.engine.setView(aspect, zoom) } }

    @JavascriptInterface
    fun setBrightness(v: Double) { main.post { act.setBrightness(v) } }

    @JavascriptInterface
    fun insets(): String = act.insetsJson()

    companion object {
        fun toJs(v: Any?): String {
            val w = JSONObject.wrap(v) ?: return "null"
            return if (w is String) JSONObject.quote(w) else w.toString()
        }
    }
}
