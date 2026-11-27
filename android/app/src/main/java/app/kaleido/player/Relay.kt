package app.kaleido.player

import android.util.Base64
import android.util.Log
import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// The desktop's streaming/relay.js for Android: VLC asks 127.0.0.1, and the relay asks the stream's
// host with the headers the embed player used (its Origin above all, which VLC cannot send).
// Playlists are rewritten to come back through here; segments wearing a fake image header lose it.
object Relay {
    private class Stream(val headers: Map<String, String>, val at: Long)

    private val streams = ConcurrentHashMap<String, Stream>()
    private val pool = Executors.newCachedThreadPool()
    private var server: ServerSocket? = null
    private val random = SecureRandom()
    private const val TTL = 12 * 60 * 60 * 1000L

    private fun enc(s: String) = Base64.encodeToString(s.toByteArray(), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    private fun dec(s: String) = String(Base64.decode(s, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
    private fun port() = server!!.localPort
    private fun relayed(token: String, url: String, tail: String = "") = "http://127.0.0.1:${port()}/r/$token/${enc(url)}$tail"

    @Synchronized
    private fun start() {
        if (server != null) return
        val s = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        server = s
        Thread({
            while (!s.isClosed) {
                val c = try { s.accept() } catch (_: Exception) { break }
                pool.execute { serve(c) }
            }
        }, "kaleido-relay").apply { isDaemon = true }.start()
    }

    fun register(url: String, headers: Map<String, String>): String {
        start()
        val now = System.currentTimeMillis()
        streams.entries.removeIf { now - it.value.at > TTL }
        val bytes = ByteArray(18).also { random.nextBytes(it) }
        val token = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        streams[token] = Stream(headers.filterValues { it.isNotEmpty() }, now)
        return relayed(token, url, "/index.m3u8")
    }

    private fun rewrite(text: String, base: URL, token: String): String {
        fun abs(u: String) = try { relayed(token, URL(base, u).toString()) } catch (_: Exception) { u }
        return text.lines().joinToString("\n") { line ->
            val t = line.trim()
            when {
                t.isEmpty() -> line
                t.startsWith("#") -> line.replace(Regex("URI=\"([^\"]+)\"")) { "URI=\"${abs(it.groupValues[1])}\"" }
                else -> abs(t)
            }
        }
    }

    private fun readHead(input: InputStream): List<String> {
        val lines = mutableListOf<String>()
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b < 0) break
            if (b == '\n'.code) {
                val l = sb.toString().trimEnd('\r')
                sb.setLength(0)
                if (l.isEmpty()) break
                lines += l
            } else sb.append(b.toChar())
            if (sb.length > 16384) break
        }
        return lines
    }

    private fun reply(out: OutputStream, status: Int, headers: Map<String, String>, body: ByteArray?, head: Boolean) {
        val sb = StringBuilder("HTTP/1.1 $status ${if (status < 400) "OK" else "Error"}\r\n")
        headers.forEach { (k, v) -> sb.append(k).append(": ").append(v).append("\r\n") }
        if (body != null) sb.append("Content-Length: ").append(body.size).append("\r\n")
        sb.append("Connection: close\r\n\r\n")
        out.write(sb.toString().toByteArray())
        if (body != null && !head) out.write(body)
        out.flush()
    }

    private fun disguised(b: ByteArray) = b.size > 8 && ((b[0] == 0x89.toByte() && b[1] == 0x50.toByte() && b[2] == 0x4e.toByte() && b[3] == 0x47.toByte()) ||
        (b[0] == 0xff.toByte() && b[1] == 0xd8.toByte()) || (b[0] == 0x47.toByte() && b[1] == 0x49.toByte() && b[2] == 0x46.toByte() && b[3] == 0x38.toByte()))

    private fun tsStart(b: ByteArray): Int {
        var i = 1
        while (i + 188 * 3 < b.size) {
            if (b[i] == 0x47.toByte() && b[i + 188] == 0x47.toByte() && b[i + 376] == 0x47.toByte() && b[i + 564] == 0x47.toByte()) return i
            i++
        }
        return 0
    }

    // Android's libVLC aborts on HLS whose timestamps start at zero (an assertion in its adaptive
    // demuxer; desktop VLC copes). VidZee's re-wrapped segments do, so their PCR, PTS and DTS all
    // move 10 seconds later; every segment of a stream moves alike, and positions come from the
    // playlist, so nothing else changes.
    private const val SHIFT = 10L * 90000
    private const val WRAP = 1L shl 33

    private fun ts33(b: ByteArray, p: Int) = ((b[p].toLong() shr 1) and 7 shl 30) or ((b[p + 1].toLong() and 0xff) shl 22) or
        ((b[p + 2].toLong() and 0xff) shr 1 shl 15) or ((b[p + 3].toLong() and 0xff) shl 7) or ((b[p + 4].toLong() and 0xff) shr 1)

    private fun put33(b: ByteArray, p: Int, v: Long) {
        b[p] = ((b[p].toInt() and 0xf0) or (((v shr 30) and 7).toInt() shl 1) or 1).toByte()
        b[p + 1] = (v shr 22).toByte()
        b[p + 2] = ((((v shr 15) and 0x7f).toInt() shl 1) or 1).toByte()
        b[p + 3] = (v shr 7).toByte()
        b[p + 4] = (((v and 0x7f).toInt() shl 1) or 1).toByte()
    }

    private fun shiftTs(b: ByteArray) {
        var i = 0
        while (i + 188 <= b.size) {
            if (b[i] != 0x47.toByte()) { i++; continue }
            val pusi = b[i + 1].toInt() and 0x40 != 0
            val afc = (b[i + 3].toInt() shr 4) and 3
            var p = i + 4
            if (afc and 2 != 0) {
                val len = b[p].toInt() and 0xff
                if (len >= 7 && b[p + 1].toInt() and 0x10 != 0) {
                    val q = p + 2
                    var base = ((b[q].toLong() and 0xff) shl 25) or ((b[q + 1].toLong() and 0xff) shl 17) or ((b[q + 2].toLong() and 0xff) shl 9) or
                        ((b[q + 3].toLong() and 0xff) shl 1) or ((b[q + 4].toLong() and 0xff) shr 7)
                    base = (base + SHIFT) % WRAP
                    b[q] = (base shr 25).toByte(); b[q + 1] = (base shr 17).toByte(); b[q + 2] = (base shr 9).toByte(); b[q + 3] = (base shr 1).toByte()
                    b[q + 4] = ((b[q + 4].toInt() and 0x7f) or (((base and 1).toInt()) shl 7)).toByte()
                }
                p += 1 + len
            }
            if (afc and 1 != 0 && pusi && p + 19 <= i + 188 && b[p] == 0.toByte() && b[p + 1] == 0.toByte() && b[p + 2] == 1.toByte()) {
                val flags = (b[p + 7].toInt() shr 6) and 3
                if (flags and 2 != 0) put33(b, p + 9, (ts33(b, p + 9) + SHIFT) % WRAP)
                if (flags == 3) put33(b, p + 14, (ts33(b, p + 14) + SHIFT) % WRAP)
            }
            i += 188
        }
    }

    private fun serve(c: Socket) {
        c.use { sock ->
            try {
                sock.soTimeout = 30000
                val input = BufferedInputStream(sock.getInputStream())
                val out = sock.getOutputStream()
                val head = readHead(input)
                val parts = head.firstOrNull()?.split(" ") ?: return
                val method = parts.getOrNull(0) ?: return
                val m = Regex("^/r/([\\w-]+)/([\\w-]+)").find(parts.getOrNull(1) ?: "")
                val s = m?.let { streams[it.groupValues[1]] }
                if (s == null || (method != "GET" && method != "HEAD")) { reply(out, 404, emptyMap(), ByteArray(0), false); return }
                val target = dec(m.groupValues[2])
                if (!target.startsWith("https://") && !target.startsWith("http://")) { reply(out, 400, emptyMap(), ByteArray(0), false); return }
                val range = head.drop(1).firstOrNull { it.startsWith("range:", true) }?.substringAfter(':')?.trim()
                val isHead = method == "HEAD"

                val up = URL(target).openConnection() as HttpURLConnection
                up.connectTimeout = 10000
                up.readTimeout = 30000
                up.instanceFollowRedirects = true
                s.headers.forEach { (k, v) -> up.setRequestProperty(k, v) }
                if (range != null) up.setRequestProperty("Range", range)
                val status = up.responseCode
                val type = (up.contentType ?: "").lowercase()
                val length = up.contentLengthLong
                val stream = (if (status >= 400) up.errorStream else up.inputStream) ?: run { reply(out, status, emptyMap(), ByteArray(0), isHead); return }
                stream.use { body ->
                    val playlistLike = "mpegurl" in type || Regex("\\.m3u8(\\?|$)").containsMatchIn(target) || (type.startsWith("text/plain") && length in 0..4_000_000)
                    if (playlistLike) {
                        val text = body.readBytes().toString(Charsets.UTF_8)
                        if (text.trimStart().startsWith("#EXTM3U")) {
                            val out2 = rewrite(text, up.url, m.groupValues[1]).toByteArray()
                            reply(out, status, mapOf("Content-Type" to "application/vnd.apple.mpegurl", "Cache-Control" to "no-store"), out2, isHead)
                        } else reply(out, status, mapOf("Content-Type" to "application/octet-stream"), text.toByteArray(), isHead)
                        return
                    }
                    val outType = if (type.startsWith("text/html") || type.startsWith("image/") || type.isEmpty()) "application/octet-stream" else type
                    if (range == null && (type.startsWith("image/") || length in 0..4_000_000)) {
                        val all = body.readBytes()
                        val at = if (disguised(all)) tsStart(all) else 0
                        val seg = if (at > 0) all.copyOfRange(at, all.size).also { shiftTs(it) } else all
                        reply(out, status, mapOf("Content-Type" to if (at > 0) "video/mp2t" else outType), seg, isHead)
                        return
                    }
                    val hs = linkedMapOf("Content-Type" to outType)
                    up.getHeaderField("Content-Range")?.let { hs["Content-Range"] = it }
                    up.getHeaderField("Accept-Ranges")?.let { hs["Accept-Ranges"] = it }
                    if (length >= 0) hs["Content-Length"] = length.toString()
                    reply(out, status, hs, null, isHead)
                    if (!isHead) body.copyTo(out, 64 * 1024)
                }
            } catch (e: Exception) {
                Log.d("Kaleido", "relay: ${e.message}")
            }
        }
    }
}
