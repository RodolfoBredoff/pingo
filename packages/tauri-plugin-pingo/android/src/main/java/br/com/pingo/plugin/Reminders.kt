package br.com.pingo.plugin

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lembretes agendados no sistema, com persistência própria.
 *
 * O plugin oficial de notificações do Tauri agenda o alarme mas não guarda nada em disco, então
 * o alarme se perde quando o aparelho reinicia. Aqui o JavaScript manda a lista COMPLETA dos
 * próximos lembretes (`sync`), o plugin guarda, agenda e, depois do boot, agenda de novo.
 *
 * Hora aproximada de propósito: `setAndAllowWhileIdle` não exige a permissão de alarme exato.
 * A notificação leva só título e horário, nunca o texto da mensagem original.
 */
data class Reminder(val id: Int, val atMs: Long, val title: String, val body: String)

class ReminderStore(context: Context) {
    private val prefs = context.getSharedPreferences("pingo_reminders", Context.MODE_PRIVATE)

    fun all(): List<Reminder> {
        val raw = prefs.getString("items", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Reminder(o.getInt("id"), o.getLong("atMs"), o.getString("title"), o.getString("body"))
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun save(items: Collection<Reminder>) {
        val arr = JSONArray()
        for (r in items) {
            arr.put(
                JSONObject().put("id", r.id).put("atMs", r.atMs).put("title", r.title).put("body", r.body),
            )
        }
        prefs.edit().putString("items", arr.toString()).apply()
    }
}

object ReminderScheduler {
    const val CHANNEL_ID = "pingo_reminders"
    private const val ACTION = "br.com.pingo.REMINDER"
    private const val EXTRA_ID = "reminderId"

    private fun alarmIntent(context: Context, id: Int): Intent =
        Intent(context, ReminderReceiver::class.java)
            .setAction(ACTION)
            .setData(Uri.parse("pingo://reminder/$id"))
            .putExtra(EXTRA_ID, id)

    fun idOf(intent: Intent): Int = intent.getIntExtra(EXTRA_ID, Int.MIN_VALUE)

    @SuppressLint("ScheduleExactAlarm")
    fun schedule(context: Context, r: Reminder) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(
            context,
            r.id,
            alarmIntent(context, r.id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.atMs, pi)
    }

    fun cancel(context: Context, id: Int) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = PendingIntent.getBroadcast(
            context,
            id,
            alarmIntent(context, id),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        )
        if (pi != null) {
            am.cancel(pi)
            pi.cancel()
        }
    }

    @SuppressLint("MissingPermission")
    fun post(context: Context, r: Reminder) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Lembretes", NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val content = open?.let {
            PendingIntent.getActivity(context, r.id, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(r.title)
            .setContentText(r.body)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(content)
            .build()
        nm.notify(r.id, n)
    }

    /**
     * Alinha o sistema com a lista que o app mandou (os próximos lembretes). O que sobrou no
     * armazenamento e não veio na lista: se ainda é futuro, foi cancelado (o item saiu da agenda);
     * se já passou sem ser entregue (alarme perdido), avisa agora.
     */
    fun sync(context: Context, wanted: List<Reminder>, now: Long = System.currentTimeMillis()): JSONObject {
        val store = ReminderStore(context)
        val next = wanted.filter { it.atMs > now }.associateBy { it.id }
        var cancelled = 0
        var late = 0
        for (old in store.all()) {
            if (next.containsKey(old.id)) continue
            cancel(context, old.id)
            if (old.atMs <= now) {
                post(context, old)
                late++
            } else {
                cancelled++
            }
        }
        for (r in next.values) schedule(context, r)
        store.save(next.values)
        return JSONObject().put("scheduled", next.size).put("cancelled", cancelled).put("late", late)
    }

    /** Depois de reiniciar (ou atualizar o app): reagenda o futuro e avisa o que venceu com o aparelho desligado. */
    fun restore(context: Context, now: Long = System.currentTimeMillis()) {
        val store = ReminderStore(context)
        val keep = mutableListOf<Reminder>()
        for (r in store.all()) {
            if (r.atMs <= now) {
                post(context, r)
            } else {
                schedule(context, r)
                keep.add(r)
            }
        }
        store.save(keep)
    }
}

/** Dispara na hora do alarme: mostra a notificação e tira o lembrete do armazenamento. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = ReminderScheduler.idOf(intent)
        if (id == Int.MIN_VALUE) return
        val store = ReminderStore(context)
        val all = store.all()
        val r = all.firstOrNull { it.id == id } ?: return
        ReminderScheduler.post(context, r)
        store.save(all.filter { it.id != id })
    }
}

/** Reinício do aparelho ou atualização do app: os alarmes do sistema se perdem, o armazenamento não. */
class ReminderBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> ReminderScheduler.restore(context)
        }
    }
}
