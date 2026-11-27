package br.com.pingo.plugin

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import app.tauri.plugin.JSObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * Caixa de entrada do Compartilhar: recebe o Intent SEND / SEND_MULTIPLE de qualquer app,
 * copia os arquivos para o cache do Pingo (o acesso do compartilhamento é temporário) e guarda
 * uma lista de itens até o JavaScript buscar com `take()`.
 */
class ShareInbox(private val context: Context) {
    val dir: File = File(context.cacheDir, "shared").apply { mkdirs() }
    private val queue = ArrayList<JSObject>()

    @Synchronized
    fun take(): List<JSObject> {
        val out = ArrayList(queue)
        queue.clear()
        return out
    }

    /** Lê um Intent. Ignora o que não é compartilhamento e o que já foi lido. */
    @Synchronized
    fun ingest(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return
        if (intent.getBooleanExtra(CONSUMED, false)) return
        intent.putExtra(CONSUMED, true)

        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        val declared = intent.type ?: ""
        val uris = streams(intent)

        if (uris.isEmpty()) {
            if (!text.isNullOrBlank()) {
                queue.add(
                    JSObject().put("id", UUID.randomUUID().toString()).put("kind", "text").put("text", text)
                        .put("mime", "text/plain"),
                )
            }
            return
        }
        for (uri in uris) queue.add(copy(uri, declared, text))
    }

    private fun copy(uri: Uri, declared: String, caption: String?): JSObject {
        val id = UUID.randomUUID().toString()
        val resolver = context.contentResolver
        val mime = (resolver.getType(uri) ?: declared).ifBlank { "application/octet-stream" }
        val name = displayName(uri)
        val item = JSObject().put("id", id).put("mime", mime).put("kind", kindOf(mime)).put("name", name)
        if (!caption.isNullOrBlank()) item.put("text", caption)

        val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "bin"
        val file = File(dir, "$id.$ext")
        try {
            var total = 0L
            resolver.openInputStream(uri).use { input ->
                if (input == null) throw IllegalStateException("sem acesso ao arquivo")
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_BYTES) throw TooLarge()
                        out.write(buf, 0, n)
                    }
                }
            }
            item.put("path", file.absolutePath).put("size", total)
        } catch (e: TooLarge) {
            file.delete()
            item.put("error", "too_large")
        } catch (e: Exception) {
            file.delete()
            item.put("error", "unreadable")
        }
        return item
    }

    private fun displayName(uri: Uri): String {
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            } ?: uri.lastPathSegment ?: "compartilhado"
        } catch (e: Exception) {
            "compartilhado"
        }
    }

    private fun kindOf(mime: String): String = when {
        mime.startsWith("image/") -> "image"
        mime == "application/pdf" -> "pdf"
        mime.startsWith("audio/") -> "audio"
        mime.startsWith("text/") -> "text"
        else -> "other"
    }

    @Suppress("DEPRECATION")
    private fun streams(intent: Intent): List<Uri> {
        return if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
            } else {
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
            }
        } else {
            val one = if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            }
            listOfNotNull(one)
        }
    }

    private class TooLarge : Exception()

    private companion object {
        const val MAX_BYTES = 10L * 1024 * 1024
        const val CONSUMED = "br.com.pingo.share.consumed"
    }
}
