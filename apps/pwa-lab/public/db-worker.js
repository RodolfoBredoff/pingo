// Worker do SQLite no navegador (WASM + OPFS). O banco fica no armazenamento privado do app.
import sqlite3InitModule from '/vendor/sqlite/index.mjs'

let db
let info = {}

async function init() {
  if (db) return info
  const sqlite3 = await sqlite3InitModule()
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'pingo-lab-pool' })
  db = new pool.OpfsSAHPoolDb('/lab.db')
  db.exec(
    'create table if not exists t (id integer primary key, v text not null, at text not null)',
  )
  info = { sqlite: sqlite3.version.libVersion, vfs: 'opfs-sahpool', arquivos: pool.getFileCount() }
  return info
}

const count = () => db.selectValue('select count(*) from t')

self.onmessage = async (e) => {
  const { op, n } = e.data
  const t0 = performance.now()
  try {
    if (op === 'init') {
      const i = await init()
      self.postMessage({ op, ok: true, info: i, rows: count(), ms: performance.now() - t0 })
    } else if (op === 'insert') {
      await init()
      db.exec('begin')
      for (let i = 0; i < n; i++) {
        db.exec({
          sql: 'insert into t (v, at) values (?, ?)',
          bind: [`linha ${i} ção ñ 😀`, new Date().toISOString()],
        })
      }
      db.exec('commit')
      self.postMessage({ op, ok: true, rows: count(), ms: performance.now() - t0 })
    } else if (op === 'clear') {
      await init()
      db.exec('delete from t')
      self.postMessage({ op, ok: true, rows: count(), ms: performance.now() - t0 })
    }
  } catch (err) {
    self.postMessage({ op, ok: false, error: String(err && err.message ? err.message : err) })
  }
}
