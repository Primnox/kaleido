package app.kaleido.player

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest

// What the desktop app does with the file system and FFmpeg, done with Android's own media tools:
// MediaStore for the library, MediaMetadataRetriever for thumbnails, posters and durations.
class Library(private val ctx: Context) {
    private val videoExt = "mp4 m4v mkv webm avi mov wmv flv mpg mpeg ts m2ts mts 3gp 3g2 ogv vob divx f4v rm rmvb asf mxf".split(' ').toSet()
    private val audioExt = "mp3 m4a aac flac wav ogg oga opus wma alac aiff aif ape mka wv".split(' ').toSet()
    private val subExt = "srt vtt ass ssa sub idx smi".split(' ').toSet()
    private val durations = HashMap<String, Double>()

    private fun extOf(p: String) = p.substringAfterLast('.', "").lowercase()

    // Real paths where Android allows them, so names, folders and "the next file in this folder"
    // work as on the desktop. Anything else stays a content URI that libVLC opens directly.
    fun resolve(uri: Uri): String {
        if (uri.scheme == "file") return uri.path ?: uri.toString()
        if (uri.scheme != "content") return uri.toString()
        try {
            ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { if (File(it).canRead()) return it }
            }
        } catch (_: Exception) {}
        try {
            if (DocumentsContract.isDocumentUri(ctx, uri)) storagePath(DocumentsContract.getDocumentId(uri))?.let { return it }
        } catch (_: Exception) {}
        try {
            ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {}
        return uri.toString()
    }

    fun resolveTree(uri: Uri): String? = try {
        storagePath(DocumentsContract.getTreeDocumentId(uri))
    } catch (_: Exception) { null }

    // "primary:Movies/Film.mkv" from the storage provider is /storage/emulated/0/Movies/Film.mkv.
    private fun storagePath(docId: String): String? {
        val parts = docId.split(':', limit = 2)
        if (parts.size != 2) return null
        val base = if (parts[0] == "primary") Environment.getExternalStorageDirectory() else File("/storage/${parts[0]}")
        val f = File(base, parts[1])
        return if (f.exists()) f.absolutePath else null
    }

    fun expand(paths: JSONArray?): JSONArray {
        val out = JSONArray()
        fun walk(p: String, depth: Int) {
            if (p.contains("://")) { out.put(p); return }
            val f = File(p)
            if (f.isDirectory) {
                if (depth > 3) return
                f.listFiles()?.map { it.absolutePath }?.sortedWith(natural)?.forEach { walk(it, depth + 1) }
            } else if (f.exists() && (extOf(p) in videoExt || extOf(p) in audioExt || extOf(p) in subExt)) out.put(p)
        }
        for (i in 0 until (paths?.length() ?: 0)) walk(paths!!.getString(i), 0)
        return out
    }

    fun siblings(file: String): JSONArray {
        if (file.contains("://")) return JSONArray().put(file)
        val dir = File(file).parentFile ?: return JSONArray().put(file)
        val kind = if (extOf(file) in audioExt) audioExt else videoExt
        val names = dir.listFiles()?.filter { extOf(it.name) in kind }?.map { it.absolutePath }?.sortedWith(natural) ?: listOf(file)
        return JSONArray(names.ifEmpty { listOf(file) })
    }

    // Every video Android knows about, newest first, limited to the chosen folders.
    fun scan(folders: JSONArray?): JSONArray {
        val roots = (0 until (folders?.length() ?: 0)).map { folders!!.getString(it).trimEnd('/') + "/" }
        val out = JSONArray()
        val proj = arrayOf(MediaStore.Video.Media.DATA, MediaStore.Video.Media.DISPLAY_NAME)
        ctx.contentResolver.query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, proj, null, null,
            "${MediaStore.Video.Media.DATE_MODIFIED} DESC")?.use { c ->
            while (c.moveToNext() && out.length() < 800) {
                val path = c.getString(0) ?: continue
                if (roots.isNotEmpty() && roots.none { path.startsWith(it) }) continue
                val f = File(path)
                out.put(JSONObject().put("path", path).put("name", c.getString(1) ?: f.name).put("folder", f.parentFile?.name ?: ""))
            }
        }
        return out
    }

    fun stat(file: String): JSONObject? {
        if (file.contains("://")) return null
        val f = File(file)
        return if (f.exists()) JSONObject().put("size", f.length()).put("modified", f.lastModified()) else null
    }

    fun duration(file: String): Double {
        durations[file]?.let { return it }
        val d = retrieve(file) { r -> r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let { it / 1000.0 } } ?: 0.0
        durations[file] = d
        return d
    }

    fun thumb(file: String, t: Double, width: Int): String? = frame(file, t, width)?.let { dataUrl(it, 80) }

    // Posters are cached on disk per file version, like the desktop app.
    fun poster(file: String, t: Double): String? {
        val st = stat(file) ?: return null
        val key = MessageDigest.getInstance("SHA-1").digest("$file|${st.optLong("modified")}|${Math.round(t)}".toByteArray())
            .joinToString("") { "%02x".format(it) }
        val out = File(File(ctx.cacheDir, "posters").apply { mkdirs() }, "$key.jpg")
        if (out.exists()) return "data:image/jpeg;base64," + Base64.encodeToString(out.readBytes(), Base64.NO_WRAP)
        val bmp = frame(file, t, 480) ?: (if (t > 1) frame(file, 1.0, 480) else null) ?: return null
        val bytes = jpeg(bmp, 82)
        out.writeBytes(bytes)
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun frame(file: String, t: Double, width: Int): Bitmap? = retrieve(file) { r ->
        val us = (t.coerceAtLeast(0.0) * 1_000_000).toLong()
        var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: return@retrieve null
        var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: return@retrieve null
        val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        if (rot == 90 || rot == 270) w = h.also { h = w }
        val outW = width.coerceAtMost(w)
        val outH = (outW.toDouble() * h / w).toInt().coerceAtLeast(2)
        if (Build.VERSION.SDK_INT >= 27) r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, outW, outH)
        else r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { Bitmap.createScaledBitmap(it, outW, outH, true) }
    }

    private fun <T> retrieve(file: String, fn: (MediaMetadataRetriever) -> T?): T? {
        if (file.contains("://") && !file.startsWith("content://")) return null
        val r = MediaMetadataRetriever()
        return try {
            if (file.startsWith("content://")) r.setDataSource(ctx, Uri.parse(file)) else r.setDataSource(file)
            fn(r)
        } catch (_: Exception) {
            null
        } finally {
            try { r.release() } catch (_: Exception) {}
        }
    }

    companion object {
        fun jpeg(b: Bitmap, quality: Int): ByteArray = ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()

        fun dataUrl(b: Bitmap, quality: Int) = "data:image/jpeg;base64," + Base64.encodeToString(jpeg(b, quality), Base64.NO_WRAP)

        // "Episode 2" before "Episode 10", the way the desktop's Intl.Collator sorts.
        val natural = Comparator<String> { x, y ->
            val a = x.lowercase()
            val b = y.lowercase()
            var i = 0
            var j = 0
            while (i < a.length && j < b.length) {
                if (a[i].isDigit() && b[j].isDigit()) {
                    var ei = i
                    while (ei < a.length && a[ei].isDigit()) ei++
                    var ej = j
                    while (ej < b.length && b[ej].isDigit()) ej++
                    val na = a.substring(i, ei).trimStart('0')
                    val nb = b.substring(j, ej).trimStart('0')
                    if (na.length != nb.length) return@Comparator na.length - nb.length
                    val c = na.compareTo(nb)
                    if (c != 0) return@Comparator c
                    i = ei
                    j = ej
                } else {
                    if (a[i] != b[j]) return@Comparator a[i] - b[j]
                    i++
                    j++
                }
            }
            (a.length - i) - (b.length - j)
        }
    }
}
