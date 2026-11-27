package br.com.pingo.plugin

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SecretArgs {
    lateinit var key: String
    var value: String? = null
}

@TauriPlugin
class PingoPlugin(private val activity: Activity) : Plugin(activity) {
    private val vault = SecretVault(activity.applicationContext)
    private val shares = ShareInbox(activity.applicationContext)

    // Partida a frio: o app foi aberto pelo Compartilhar.
    override fun load(webView: WebView) {
        shares.ingest(activity.intent)
    }

    // Partida a quente: o app já estava aberto (launchMode singleTask).
    override fun onNewIntent(intent: Intent) {
        shares.ingest(intent)
    }

    @Command
    fun takeShared(invoke: Invoke) {
        try {
            val items = JSArray()
            for (item in shares.take()) items.put(item)
            val out = JSObject()
            out.put("dir", shares.dir.absolutePath)
            out.put("items", items)
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "falha ao ler os compartilhamentos")
        }
    }

    @Command
    fun secretSet(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretArgs::class.java)
            vault.set(args.key, args.value ?: throw IllegalArgumentException("valor ausente"))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "falha ao guardar o segredo")
        }
    }

    @Command
    fun secretGet(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SecretArgs::class.java)
            val out = JSObject()
            out.put("value", vault.get(args.key))
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "falha ao ler o segredo")
        }
    }

    @Command
    fun secretDelete(invoke: Invoke) {
        try {
            vault.delete(invoke.parseArgs(SecretArgs::class.java).key)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "falha ao apagar o segredo")
        }
    }
}
