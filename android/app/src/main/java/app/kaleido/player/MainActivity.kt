package app.kaleido.player

import android.Manifest
import android.annotation.SuppressLint
import android.app.PictureInPictureParams
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log
import android.util.Rational
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import org.videolan.libvlc.util.VLCVideoLayout
import java.util.concurrent.Executors
import kotlin.math.roundToInt

// One screen: libVLC's picture at the bottom, the Kaleido page on top of it with a see-through
// background wherever the picture should show.
class MainActivity : ComponentActivity() {
    lateinit var web: WebView
    lateinit var engine: Engine
    lateinit var library: Library
    private lateinit var videoBox: FrameLayout
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val pendingOpen = mutableListOf<String>()
    private var pageAsked = false
    private var playing = false
    private var immersive = false
    private var inPip = false
    private var stage: DoubleArray? = null
    private var insets = intArrayOf(0, 0, 0, 0)
    private var pickDone: ((Any?) -> Unit)? = null
    private var pickKind = ""

    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val paths = uris.map { library.resolve(it) }
        finishPick(if (pickKind == "openSubtitle") paths.firstOrNull() else JSONArray(paths))
    }
    private val pickTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        val dir = uri?.let { library.resolveTree(it) }
        if (pickKind == "openFolder") {
            io.execute { val files = if (dir != null) library.expand(JSONArray().put(dir)) else JSONArray(); main.post { finishPick(files) } }
        } else finishPick(dir)
    }
    private val askAccess = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) js("__kaleido.mediaAccess()")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        videoBox = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val videoLayout = VLCVideoLayout(this)
        videoBox.addView(videoLayout, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(videoBox, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        library = Library(this)
        engine = Engine(this, videoLayout)
        setupWeb()

        // The page lays itself out around status bars, the navigation bar and camera cutouts.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, all ->
            val i = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            insets = intArrayOf(i.top, i.right, i.bottom, i.left)
            js("__kaleido.insets(${insetsJson()})")
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__kaleido ? __kaleido.back() : false") { r ->
                    if (r != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        handleIntent(intent)
        askMediaAccess()
        main.post(glimpseLoop)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWeb() {
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        web.setBackgroundColor(Color.TRANSPARENT)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            textZoom = 100
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/web/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        val shim = assets.open("kaleido-host.js").bufferedReader().use { it.readText() }
        val startScript = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (startScript) WebViewCompat.addDocumentStartJavaScript(web, shim, setOf("https://$ORIGIN"))
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == ORIGIN) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                // Older WebViews without document-start scripts: early enough, since the page's
                // own code is a module and runs after parsing.
                if (!startScript) view.evaluateJavascript(shim, null)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.i("Kaleido", "${m.message()} (${m.sourceId().substringAfterLast('/')}:${m.lineNumber()})")
                return true
            }
        }
        web.addJavascriptInterface(Host(this), "KaleidoNative")
        web.loadUrl("https://$ORIGIN/web/src/index.html")
    }

    // Calls into the page's bridge; harmless while the page is still loading.
    fun js(code: String) {
        val guarded = "window.__kaleido && $code"
        if (Looper.myLooper() == Looper.getMainLooper()) web.evaluateJavascript(guarded, null)
        else main.post { web.evaluateJavascript(guarded, null) }
    }

    fun insetsJson(): String {
        val d = resources.displayMetrics.density
        return JSONArray(insets.map { (it / d).roundToInt() }).toString()
    }

    // ---------- the picture ----------

    // The page reports where its stage is (CSS pixels); the native picture sits exactly there.
    fun placeVideo(x: Double, y: Double, w: Double, h: Double) {
        stage = doubleArrayOf(x, y, w, h)
        if (!inPip) applyStage()
    }

    private fun applyStage() {
        val s = stage ?: return
        val d = resources.displayMetrics.density
        val lp = FrameLayout.LayoutParams((s[2] * d).roundToInt().coerceAtLeast(1), (s[3] * d).roundToInt().coerceAtLeast(1))
        lp.leftMargin = (s[0] * d).roundToInt()
        lp.topMargin = (s[1] * d).roundToInt()
        videoBox.layoutParams = lp
    }

    // A small, frequent look at the picture: the page uses it for scene colour, ambient glows and
    // measuring letterbox bars, which the desktop reads straight from VLC's frames.
    private val glimpseLoop = object : Runnable {
        override fun run() {
            main.postDelayed(this, 1500)
            if (!playing || inPip || !engine.hasVideo()) return
            val b = engine.grab(160) ?: return
            io.execute { js("__kaleido.glimpse(${JSONObject.quote(Library.dataUrl(b, 70))})") }
        }
    }

    fun onVideoSize(w: Int, h: Int, sar: Double) {
        if (w <= 0 || h <= 0) return
        requestedOrientation = if (w * sar >= h) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        showFullScreen(true)
    }

    fun onPlaying(on: Boolean) {
        playing = on
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun onStopped() {
        onPlaying(false)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        showFullScreen(false)
    }

    private fun showFullScreen(on: Boolean) {
        immersive = on
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (on) c.hide(WindowInsetsCompat.Type.systemBars()) else c.show(WindowInsetsCompat.Type.systemBars())
        js("__kaleido.emit('fullscreen', $on)")
    }

    fun setBrightness(v: Double) {
        window.attributes = window.attributes.apply { screenBrightness = if (v < 0) -1f else v.toFloat().coerceIn(0.01f, 1f) }
    }

    fun saveSnapshot(name: String) {
        val b = engine.grab(4096) ?: return
        io.execute {
            val file = name.ifEmpty { "Kaleido ${System.currentTimeMillis()}.png" }
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, file)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= 29) put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Kaleido")
            }
            try {
                contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)?.let { uri ->
                    contentResolver.openOutputStream(uri)?.use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    val ev = JSONObject().put("ev", "snapshot").put("path", "Pictures/Kaleido/$file")
                    js("__kaleido.engineEvent(${JSONObject.quote(ev.toString())})")
                }
            } catch (e: Exception) {
                Log.w("Kaleido", "snapshot failed", e)
            }
        }
    }

    // ---------- mini player: Android's picture in picture ----------

    private fun enterMini(): Boolean {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false
        val w = engine.videoWidth.takeIf { it > 0 } ?: 16
        val h = engine.videoHeight.takeIf { it > 0 } ?: 9
        val r = (w.toDouble() / h).coerceIn(1 / 2.39, 2.39)
        return try {
            enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational((r * 1000).roundToInt(), 1000)).build())
        } catch (_: Exception) { false }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Leaving with the home button while a film plays keeps it going in a small window.
        if (playing && engine.hasVideo() && !inPip) enterMini()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        if (inPip) {
            web.visibility = View.INVISIBLE
            videoBox.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        } else {
            web.visibility = View.VISIBLE
            applyStage()
            js("__kaleido.emit('mini', false)")
        }
    }

    // ---------- window calls from the page ----------

    fun win(op: String, arg: Any?): Any? = when (op) {
        "minimize" -> { moveTaskToBack(true); null }
        "close" -> { finish(); null }
        "setFullScreen" -> { showFullScreen(arg == true); null }
        "state" -> JSONObject().put("fullscreen", immersive).put("maximized", false).put("alwaysOnTop", false)
        "mini" -> { if (arg == true) enterMini() else false }
        else -> null
    }

    fun pick(kind: String, done: (Any?) -> Unit) {
        pickDone?.invoke(null)
        pickDone = done
        pickKind = kind
        try {
            when (kind) {
                "openFiles" -> pickFiles.launch(arrayOf("video/*", "audio/*"))
                "openSubtitle" -> pickFiles.launch(arrayOf("*/*"))
                else -> pickTree.launch(null)
            }
        } catch (_: Exception) { finishPick(null) }
    }

    private fun finishPick(result: Any?) {
        val done = pickDone
        pickDone = null
        done?.invoke(result ?: if (pickKind == "openFiles" || pickKind == "openFolder") JSONArray() else null)
    }

    // ---------- files from other apps ----------

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        val uris = when (i?.action) {
            Intent.ACTION_VIEW -> listOfNotNull(i.data)
            Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(i, Intent.EXTRA_STREAM, Uri::class.java))
            else -> emptyList()
        }
        if (uris.isEmpty()) return
        val paths = uris.map { library.resolve(it) }
        if (pageAsked) js("__kaleido.emit('open-files', ${JSONArray(paths)})") else pendingOpen += paths
    }

    fun takeInitialFiles(): JSONArray {
        pageAsked = true
        return JSONArray(pendingOpen.toList()).also { pendingOpen.clear() }
    }

    private fun askMediaAccess() {
        val perms = if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO)
        else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        if (perms.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) return
        askAccess.launch(perms)
    }

    // ---------- lifecycle ----------

    override fun onStop() {
        super.onStop()
        // Like "pause when the PC locks": nothing plays on with the screen off or the app closed.
        if (!isChangingConfigurations && playing) engine.handle("""{"cmd":"pause"}""")
    }

    override fun onDestroy() {
        engine.release()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val ORIGIN = "appassets.androidplatform.net"
    }
}
