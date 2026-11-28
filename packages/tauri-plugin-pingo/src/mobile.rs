use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{plugin::PluginHandle, Runtime};

pub struct Pingo<R: Runtime> {
    handle: PluginHandle<R>,
    /// Pasta de arquivos recebidos pelo Compartilhar (informada pelo lado Kotlin).
    shared_dir: Mutex<Option<PathBuf>>,
}

/// Um lembrete a agendar: só título e horário (nunca o texto da mensagem original).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReminderItem {
    pub id: i32,
    pub at_ms: i64,
    pub title: String,
    pub body: String,
}

#[derive(Serialize)]
struct SecretArgs<'a> {
    key: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<&'a str>,
}

#[derive(Deserialize)]
struct SecretValue {
    value: Option<String>,
}

impl<R: Runtime> Pingo<R> {
    pub(crate) fn new(handle: PluginHandle<R>) -> Self {
        Self {
            handle,
            shared_dir: Mutex::new(None),
        }
    }

    /// Guarda um segredo cifrado com uma chave do Android Keystore (AES-256-GCM).
    pub fn secret_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>(
                "secretSet",
                SecretArgs { key, value: Some(value) },
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// `None` quando não existe (ou quando a chave do Keystore não decifra mais).
    pub fn secret_get(&self, key: &str) -> Result<Option<String>, String> {
        self.handle
            .run_mobile_plugin::<SecretValue>("secretGet", SecretArgs { key, value: None })
            .map(|r| r.value)
            .map_err(|e| e.to_string())
    }

    pub fn secret_delete(&self, key: &str) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>("secretDelete", SecretArgs { key, value: None })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Itens recebidos pelo menu Compartilhar desde a última chamada. Esvazia a fila.
    pub fn take_shared(&self) -> Result<serde_json::Value, String> {
        let v: serde_json::Value = self
            .handle
            .run_mobile_plugin("takeShared", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        if let Some(dir) = v.get("dir").and_then(|d| d.as_str()) {
            *self.shared_dir.lock().map_err(|e| e.to_string())? = Some(PathBuf::from(dir));
        }
        Ok(v)
    }

    /// Só lê arquivos que estão dentro da pasta dos compartilhados.
    fn shared_path(&self, path: &str) -> Result<PathBuf, String> {
        let dir = self
            .shared_dir
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("pasta de compartilhados desconhecida")?;
        let dir = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
        let file = std::fs::canonicalize(Path::new(path)).map_err(|e| e.to_string())?;
        if file.starts_with(&dir) {
            Ok(file)
        } else {
            Err("caminho fora da pasta de compartilhados".into())
        }
    }

    pub fn read_shared(&self, path: &str) -> Result<Vec<u8>, String> {
        std::fs::read(self.shared_path(path)?).map_err(|e| e.to_string())
    }

    pub fn discard_shared(&self, path: &str) -> Result<(), String> {
        std::fs::remove_file(self.shared_path(path)?).map_err(|e| e.to_string())
    }

    /// Manda a lista COMPLETA dos próximos lembretes. O plugin guarda, agenda os alarmes e os
    /// refaz depois de reiniciar. Devolve `{ scheduled, cancelled, late }`.
    pub fn reminders_sync(&self, items: &[ReminderItem]) -> Result<serde_json::Value, String> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>(
                "remindersSync",
                serde_json::json!({ "items": items }),
            )
            .map_err(|e| e.to_string())
    }

    /// Só em APK de depuração: importa a chave deixada em `files/dev_seed_openrouter_key`.
    pub fn dev_seed_key(&self) -> Result<bool, String> {
        #[derive(Deserialize)]
        struct Seeded {
            seeded: bool,
        }
        self.handle
            .run_mobile_plugin::<Seeded>("devSeedKey", serde_json::json!({}))
            .map(|r| r.seeded)
            .map_err(|e| e.to_string())
    }
}
