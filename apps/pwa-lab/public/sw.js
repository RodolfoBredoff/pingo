/* Service worker do laboratório: recebe o Compartilhar, mostra o push e reporta ao servidor. */
/* global self, clients, labIdb */
importScripts('/idb.js')

async function report(event, data) {
  try {
    const key = await labIdb.get('kv', 'labKey')
    if (!key) return
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lab-key': key },
      body: JSON.stringify({ event, data: { ...data, phoneTime: new Date().toISOString() } }),
    })
  } catch {
    /* sem rede: o resultado aparece na tela do app */
  }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ---- Compartilhar: o Android faz um POST multipart para /share-target
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        const t0 = Date.now()
        try {
          const form = await event.request.formData()
          const files = form.getAll('media').filter((f) => typeof f === 'object' && 'size' in f)
          const text = String(form.get('text') ?? '')
          const rec = {
            at: new Date().toISOString(),
            title: String(form.get('title') ?? ''),
            text,
            url: String(form.get('url') ?? ''),
            files: files.map((f) => ({ name: f.name, type: f.type, size: f.size, blob: f })),
          }
          const id = await labIdb.add('shares', rec)
          await report('share_received_by_sw', {
            id,
            textLength: text.length,
            files: files.map((f) => ({ type: f.type, size: f.size })),
            handledInMs: Date.now() - t0,
          })
          return Response.redirect(new URL('/?shared=' + id, self.location.origin).href, 303)
        } catch (e) {
          await report('share_error', { message: String(e && e.message).slice(0, 120) })
          return Response.redirect(new URL('/?share=erro', self.location.origin).href, 303)
        }
      })(),
    )
  }
})

// ---- Push: o servidor manda só o id; o texto sai do banco local (o texto nunca viaja)
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const receivedAt = Date.now()
      let data = {}
      try {
        data = event.data ? event.data.json() : {}
      } catch {
        /* payload ilegível */
      }
      const rem = data.id ? await labIdb.get('reminders', data.id) : undefined
      await self.registration.showNotification(
        rem ? rem.title : 'Lembrete (texto não encontrado)',
        {
          body: rem ? rem.body : '',
          tag: data.id || 'lab',
          data: { id: data.id },
          actions: [
            { action: 'done', title: 'Feito' },
            { action: 'snooze', title: 'Adiar 1 h' },
          ],
        },
      )
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      await report('push_received', {
        id: data.id,
        latencyMsFromSend: data.sentAt ? receivedAt - data.sentAt : null,
        foundTextLocally: !!rem,
        appWindowsOpen: wins.length,
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      await report('notification_click', {
        id: event.notification.data?.id,
        action: event.action || 'corpo',
      })
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (wins[0]) return wins[0].focus()
      return clients.openWindow('/?from=notification')
    })(),
  )
})
