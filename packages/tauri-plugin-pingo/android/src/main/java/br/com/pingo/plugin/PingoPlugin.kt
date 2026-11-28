package br.com.pingo.plugin

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import java.io.File
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

@InvokeArg
class ReminderArg {
    var id: Int = 0
    var atMs: Long = 0
    var title: String = ""
    var body: String = ""
}

@InvokeArg
class RemindersArgs {
    var items: List<ReminderArg> = emptyList()
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

    /**
     * SÓ EM APK DE DEPURAÇÃO: se existir `files/dev_seed_openrouter_key`, guarda o conteúdo no cofre
     * e apaga o arquivo. Serve para o desenvolvedor entregar a chave pelo cabo (adb run-as) sem digitar.
     * Em APK de produção (não depurável) nunca lê nada.
     */
    @Command
    fun devSeedKey(invoke: Invoke) {
        val out = JSObject()
        try {
            val debuggable = (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
            val file = File(activity.filesDir, "dev_seed_openrouter_key")
            if (debuggable && file.exists()) {
                val value = file.readText().trim()
                file.delete()
                if (value.isNotEmpty()) vault.set("openrouter_api_key", value)
                out.put("seeded", value.isNotEmpty())
            } else {
                out.put("seeded", false)
            }
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "falha ao semear a chave")
        }
    }

    /**
     * Recebe a lista COMPLETA dos próximos lembretes e alinha o sistema com ela (ver Reminders.kt).
     * Devolve quantos foram agendados, cancelados e entregues com atraso.
     */
    @Command
    fun remindersSync(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(RemindersArgs::class.java)
            val wanted = args.items.map { Reminder(it.id, it.atMs, it.title, it.body) }
            val r = ReminderScheduler.sync(activity.applicationContext, wanted)
            val out = JSObject()
            out.put("scheduled", r.getInt("scheduled"))
            out.put("cancelled", r.getInt("cancelled"))
            out.put("late", r.getInt("late"))
            invoke.resolve(out)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "falha ao agendar os lembretes")
        }
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
