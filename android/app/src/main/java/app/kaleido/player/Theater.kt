package app.kaleido.player

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

// The desktop's streaming/adblock.json (copied in by the build): ad networks, and the URL shapes
// of ad tags that hop between throwaway domains.
class AdRules(private val host: Regex?, private val urls: List<Regex>) {
    fun blocks(u: Uri): Boolean {
        val h = u.host ?: return false
        val s = u.toString()
        return host?.containsMatchIn(h) == true || urls.any { it.containsMatchIn(s) }
    }

    companion object {
        fun load(act: MainActivity): AdRules = try {
            val o = JSONObject(act.assets.open("streaming/adblock.json").bufferedReader().use { it.readText() })
            val hosts = o.getJSONArray("hosts").let { a -> List(a.length()) { Regex.escape(a.getString(it)) } }
            val urls = o.getJSONArray("patterns").let { a -> List(a.length()) { Regex(a.getString(it)) } }
            AdRules(Regex("(^|\\.)(${hosts.joinToString("|")})$", RegexOption.IGNORE_CASE), urls)
        } catch (e: Exception) {
            android.util.Log.w("Kaleido", "ad rules missing", e)
            AdRules(null, emptyList())
        }
    }
}

// The streaming hub's native half. Android's WebView has no <webview> tag, so the theater asks for
// a second, locked-down WebView laid over its stage (the desktop's streaming/guest.js rules: https
// only, no pop-ups, no leaving the player's host, no ad networks). The hub's data modules run in
// the page and make their web requests through fetch() here, out of reach of other sites' CORS rules.
class Theater(private val act: MainActivity, private val root: FrameLayout) {
    private val main = Handler(Looper.getMainLooper())
    private var view: WebView? = null
    private var id = 0
    private var host = ""
    private var rect: DoubleArray? = null
    private var custom: View? = null
    private var customDone: WebChromeClient.CustomViewCallback? = null
    private val ads by lazy { AdRules.load(act) }

    // ---------- the player view ----------

    @SuppressLint("SetJavaScriptEnabled")
    fun open(newId: Int, url: String, referrer: String) {
        drop()
        id = newId
        val uri = Uri.parse(url)
        if (uri.scheme != "https" || uri.host.isNullOrEmpty()) { emit(newId, "fail", "not a secure page"); return }
        host = uri.host!!
        val w = WebView(act)
        view = w
        w.setBackgroundColor(Color.BLACK)
        w.visibility = View.INVISIBLE
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            // Pop-ups are created and then refused in onCreateWindow, instead of replacing the player.
            setSupportMultipleWindows(true)
            // Some players refuse Android's WebView by name; look like the phone's Chrome instead.
            userAgentString = userAgentString.replace("; wv)", ")").replace(Regex("Version/\\S+ "), "")
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true)
        val mine = newId
        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? {
                return if (ads.blocks(req.url)) BLOCKED() else null
            }

            // Ad scripts love top.location = '...'; the player's own page never needs to leave its host.
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                if (!req.isForMainFrame || req.isRedirect) return false
                val u = req.url
                return u.scheme != "https" || u.host != host
            }

            override fun onPageFinished(v: WebView, url: String?) {
                if (view !== v || v.visibility == View.VISIBLE) return
                v.visibility = View.VISIBLE
                emit(mine, "load")
            }

            override fun onReceivedError(v: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (view === v && req.isForMainFrame && v.visibility != View.VISIBLE) emit(mine, "fail", err.description?.toString() ?: "could not load")
            }

            // A crashed player page must not take the whole app with it.
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (view === v) { drop(); emit(mine, "fail", "the player page crashed") } else (v.parent as? ViewGroup)?.removeView(v)
                return true
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(v: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?) = false
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()

            // The player's own full-screen button: the video goes edge to edge, sideways.
            override fun onShowCustomView(v: View, done: CustomViewCallback) {
                if (custom != null) { done.onCustomViewHidden(); return }
                custom = v
                customDone = done
                root.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                act.immersive(true)
            }

            override fun onHideCustomView() = leaveFullScreen()
        }
        root.addView(w, params())
        if (referrer.startsWith("https://")) w.loadUrl(url, mapOf("Referer" to referrer))
        // Embed players are made to sit in someone's iframe, and some (2Embed) leave for another site
        // when they find themselves at the top; so frame them, on a page from their own origin.
        else w.loadDataWithBaseURL("https://$host/", frame(url), "text/html", "utf-8", null)
    }

    private fun frame(url: String): String {
        val src = url.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;")
        return "<!doctype html><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>" +
            "<iframe src=\"$src\" allow=\"autoplay; fullscreen; encrypted-media; picture-in-picture\" allowfullscreen></iframe>"
    }

    // The page reports its stage box in CSS pixels; the player sits exactly there, above the page.
    fun place(forId: Int, x: Double, y: Double, w: Double, h: Double) {
        if (forId != id) return
        rect = doubleArrayOf(x, y, w, h)
        view?.layoutParams = params()
    }

    fun close(forId: Int) { if (forId == id) drop() }

    private fun params(): FrameLayout.LayoutParams {
        val s = rect ?: return FrameLayout.LayoutParams(1, 1)
        val d = act.resources.displayMetrics.density
        return FrameLayout.LayoutParams((s[2] * d).roundToInt().coerceAtLeast(1), (s[3] * d).roundToInt().coerceAtLeast(1)).apply {
            leftMargin = (s[0] * d).roundToInt()
            topMargin = (s[1] * d).roundToInt()
        }
    }

    private fun drop() {
        leaveFullScreen()
        view?.let { v ->
            view = null
            root.removeView(v)
            v.stopLoading()
            v.destroy()
        }
        id = 0
        rect = null
    }

    private fun leaveFullScreen() {
        val v = custom ?: return
        custom = null
        root.removeView(v)
        customDone?.onCustomViewHidden()
        customDone = null
        act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        act.immersive(false)
    }

    // Back leaves the player's full screen first.
    fun back(): Boolean {
        if (custom == null) return false
        leaveFullScreen()
        return true
    }

    fun pause() { view?.onPause() }
    fun resume() { view?.onResume() }

    private fun emit(forId: Int, ev: String, why: String = "") {
        val o = JSONObject().put("id", forId).put("ev", ev).put("reason", why)
        act.js("__kaleido.emit('stream-player', $o)")
    }

    // ---------- Kaleido's own player: find the stream behind an embed ----------

    // streaming/sniff.js for Android: the embed loads in a hidden WebView under the same rules, and
    // the first HLS playlist or DASH manifest it asks for is the film. Answers what VLC needs:
    // { url, kind, play, options, subs, referrer, origin, userAgent, took } or null.
    private var sniffer: WebView? = null
    private var sniffDone: ((Any?) -> Unit)? = null
    private val sniffTimers = mutableListOf<Runnable>()

    @SuppressLint("SetJavaScriptEnabled")
    fun sniff(url: String, done: (Any?) -> Unit) {
        endSniff(null)
        val uri = Uri.parse(url)
        val pageHost = uri.host
        if (uri.scheme != "https" || pageHost.isNullOrEmpty()) { done(null); return }
        val started = System.currentTimeMillis()
        val w = WebView(act)
        sniffer = w
        sniffDone = done
        w.alpha = 0f
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            userAgentString = userAgentString.replace("; wv)", ")").replace(Regex("Version/\\S+ "), "")
        }
        val agent = w.settings.userAgentString
        // Hidden means silent: every frame's media plays muted.
        if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
            androidx.webkit.WebViewCompat.addDocumentStartJavaScript(w,
                "(()=>{const p=HTMLMediaElement.prototype,play=p.play;p.play=function(){this.muted=true;return play.apply(this,arguments)}})()", setOf("*"))
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true)
        val subs = JSONArray()
        var found = false
        val thumbs = Regex("thumb|sprite|preview|storyboard")
        fun take(media: String, kind: String, sent: Map<String, String>) {
            if (found || sniffer !== w) return
            found = true
            fun h(name: String) = sent.entries.firstOrNull { it.key.equals(name, true) }?.value ?: ""
            val ref = h("Referer")
            val origin = h("Origin")
            val ua = h("User-Agent").ifEmpty { agent }
            later(1500) {
                if (sniffer !== w) return@later
                Thread {
                    val r = JSONObject().put("url", media).put("kind", kind).put("referrer", ref).put("origin", origin).put("userAgent", ua)
                        .put("subs", subs).put("took", System.currentTimeMillis() - started)
                    if (kind == "hls") {
                        r.put("play", Relay.register(media, mapOf("Referer" to ref, "Origin" to origin, "User-Agent" to ua))).put("options", JSONArray())
                    } else {
                        val o = JSONArray()
                        if (ref.isNotEmpty()) o.put("http-referrer=$ref")
                        o.put("http-user-agent=$ua")
                        r.put("play", media).put("options", o)
                    }
                    main.post { if (sniffer === w) endSniff(r) }
                }.start()
            }
        }
        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? {
                if (ads.blocks(req.url)) return BLOCKED()
                val path = (req.url.path ?: "").lowercase()
                val media = req.url.toString()
                val sent = req.requestHeaders ?: emptyMap()
                when {
                    path.endsWith(".m3u8") -> main.post { take(media, "hls", sent) }
                    path.endsWith(".mpd") -> main.post { take(media, "dash", sent) }
                    (path.endsWith(".vtt") || path.endsWith(".srt")) && !thumbs.containsMatchIn(path) -> main.post {
                        val label = Uri.decode(path.substringAfterLast('/'))
                        if ((0 until subs.length()).none { subs.getJSONObject(it).optString("url") == media }) subs.put(JSONObject().put("url", media).put("label", label))
                    }
                }
                return null
            }

            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                if (!req.isForMainFrame || req.isRedirect) return false
                return req.url.scheme != "https" || req.url.host != pageHost
            }

            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (sniffer === v) endSniff(null) else (v.parent as? ViewGroup)?.removeView(v)
                return true
            }
        }
        w.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(v: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?) = false
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
        }
        // Behind everything, at a player's usual size, so the page lays itself out normally.
        val d = act.resources.displayMetrics.density
        root.addView(w, 0, FrameLayout.LayoutParams((640 * d).roundToInt(), (360 * d).roundToInt()))
        w.loadDataWithBaseURL("https://$pageHost/", frame(url), "text/html", "utf-8", null)
        later(16000) { if (sniffer === w) endSniff(null) }
        // Some players wait for a tap on their big play button: give them one, now and then.
        fun tap() {
            if (sniffer !== w || found) return
            val x = w.width / 2f
            val y = w.height / 2f
            val t = android.os.SystemClock.uptimeMillis()
            for (action in intArrayOf(android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_UP)) {
                val e = android.view.MotionEvent.obtain(t, t + 50, action, x, y, 0)
                w.dispatchTouchEvent(e)
                e.recycle()
            }
            later(4000) { tap() }
        }
        later(2500) { tap() }
    }

    private fun later(ms: Long, fn: () -> Unit) {
        val r = Runnable(fn)
        sniffTimers += r
        main.postDelayed(r, ms)
    }

    private fun endSniff(result: Any?) {
        sniffTimers.forEach { main.removeCallbacks(it) }
        sniffTimers.clear()
        sniffer?.let { v ->
            sniffer = null
            root.removeView(v)
            v.stopLoading()
            v.destroy()
        }
        val done = sniffDone
        sniffDone = null
        done?.invoke(result)
    }

    // ---------- ambient glow ----------

    // The desktop's guest.sample(): average each edge of what the player shows, skipping letterbox
    // bars. PixelCopy scales the player's box straight into a 32 by 18 bitmap.
    fun sample(forId: Int, done: (Any?) -> Unit) {
        val v = view
        if (forId != id || v == null || v.visibility != View.VISIBLE || custom != null || v.width < 4 || v.height < 4) { done(null); return }
        val at = IntArray(2)
        v.getLocationInWindow(at)
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(act.window, Rect(at[0], at[1], at[0] + v.width, at[1] + v.height), bmp, { code ->
                done(if (code == PixelCopy.SUCCESS) edges(bmp) else null)
                bmp.recycle()
            }, main)
        } catch (_: Exception) { done(null) }
    }

    private fun edges(bmp: Bitmap): JSONObject {
        val px = IntArray(W * H)
        bmp.getPixels(px, 0, W, 0, 0, W, H)
        fun r(i: Int) = (px[i] shr 16) and 0xff
        fun g(i: Int) = (px[i] shr 8) and 0xff
        fun b(i: Int) = px[i] and 0xff
        fun rowLum(y: Int): Double { var s = 0.0; for (x in 0 until W) { val i = y * W + x; s += b(i) * 0.07 + g(i) * 0.72 + r(i) * 0.21 }; return s / W }
        var top = 0
        var bottom = H - 1
        while (top < H / 2 && rowLum(top) < 10) top++
        while (bottom > H / 2 && rowLum(bottom) < 10) bottom--
        if (bottom - top < 4) return JSONObject().put("dark", true)
        fun avg(x0: Int, x1: Int, y0: Int, y1: Int): JSONArray {
            var rs = 0; var gs = 0; var bs = 0; var n = 0
            for (y in y0..y1) for (x in x0..x1) { val i = y * W + x; rs += r(i); gs += g(i); bs += b(i); n++ }
            return JSONArray().put((rs.toDouble() / n).roundToInt()).put((gs.toDouble() / n).roundToInt()).put((bs.toDouble() / n).roundToInt())
        }
        val band = ((bottom - top) / 4.0).roundToInt().coerceAtLeast(1)
        return JSONObject()
            .put("t", avg(0, W - 1, top, top + band - 1))
            .put("b", avg(0, W - 1, bottom - band + 1, bottom))
            .put("l", avg(0, 5, top, bottom))
            .put("r", avg(W - 6, W - 1, top, bottom))
            .put("c", avg(8, W - 9, top, bottom))
    }

    companion object {
        private const val W = 32
        private const val H = 18

        private val BLOCKED = { WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0))) }

        // fetch() for the hub's data modules (TMDB, source health checks, IPTV playlists, radio).
        // Answers { status, statusText, body } or { error }; https only.
        fun fetch(url: String, opts: JSONObject?): JSONObject {
            val u = URL(url)
            if (u.protocol != "https") return JSONObject().put("error", "only https is allowed")
            val c = u.openConnection() as HttpURLConnection
            return try {
                c.connectTimeout = 8000
                c.readTimeout = 15000
                c.instanceFollowRedirects = true
                opts?.optJSONObject("headers")?.let { hs -> hs.keys().forEach { k -> c.setRequestProperty(k, hs.optString(k)) } }
                val status = c.responseCode
                val stream = if (status >= 400) c.errorStream else c.inputStream
                val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
                JSONObject().put("status", status).put("statusText", c.responseMessage ?: "").put("body", body)
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                c.disconnect()
            }
        }
    }
}
