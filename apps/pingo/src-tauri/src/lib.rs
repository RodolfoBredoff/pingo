#[cfg(not(target_os = "android"))]
use keyring::Entry;
#[cfg(target_os = "android")]
use tauri_plugin_pingo::PingoExt;

/// Nome do serviço no keychain do sistema (macOS Keychain, Credential Manager, Secret Service).
const SERVICE: &str = "br.com.pingo.app";

/// Apenas estes segredos podem ser lidos/gravados pelo front-end.
const ALLOWED_KEYS: &[&str] = &["openrouter_api_key", "relay_token", "spike_test"];

fn check_allowed(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("segredo não permitido: {key}"))
    }
}

#[cfg(not(target_os = "android"))]
fn entry(key: &str) -> Result<Entry, String> {
    check_allowed(key)?;
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

// No macOS o segredo fica no Keychain; no Android, no Keystore (plugin do Pingo).
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

/// Devolve `None` quando o segredo ainda não existe.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    check_allowed(&key)?;
    app.pingo().secret_set(&key, &value)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    check_allowed(&key)?;
    app.pingo().secret_get(&key)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    check_allowed(&key)?;
    app.pingo().secret_delete(&key)
}

// ---- Compartilhar (Android): o menu "Compartilhar" de qualquer app entrega texto e arquivos ao Pingo.
// No computador não existe; os comandos respondem "nada recebido" para o JavaScript ser o mesmo.

#[cfg(target_os = "android")]
#[tauri::command]
fn shared_take(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    app.pingo().take_shared()
}

#[cfg(target_os = "android")]
#[tauri::command]
fn shared_read(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    app.pingo().read_shared(&path).map(tauri::ipc::Response::new)
}

#[cfg(target_os = "android")]
#[tauri::command]
fn shared_discard(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.pingo().discard_shared(&path)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn shared_take() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "dir": "", "items": [] }))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn shared_read(_path: String) -> Result<tauri::ipc::Response, String> {
    Err("Compartilhar só existe no Android".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn shared_discard(_path: String) -> Result<(), String> {
    Ok(())
}

// ---- Lembretes no sistema (Android): o JavaScript manda a lista completa dos próximos lembretes
// e o plugin guarda, agenda e refaz tudo depois de reiniciar. No computador os avisos saem do
// relógio do app, então aqui só responde que não há nada a fazer.

#[cfg(target_os = "android")]
#[tauri::command]
fn os_reminders_sync(
    app: tauri::AppHandle,
    items: Vec<tauri_plugin_pingo::ReminderItem>,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_pingo::PingoExt;
    app.pingo().reminders_sync(&items)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn os_reminders_sync(_items: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "scheduled": 0, "cancelled": 0, "late": 0 }))
}

/// Só em builds de desenvolvimento: imprime no terminal do `tauri dev` (verificações da Fase 0).
/// Em release não faz nada. Nunca enviar conteúdo de mensagens por aqui.
#[tauri::command]
fn dev_log(line: String) {
    #[cfg(debug_assertions)]
    println!("[webview] {line}");
    #[cfg(not(debug_assertions))]
    let _ = line;
}

/// SÓ EM DESENVOLVIMENTO: se o keychain ainda não tem a chave do OpenRouter, copia-a de
/// `.env.local` (na raiz do repositório). Em builds de release este comando não faz nada.
/// O valor nunca é impresso nem devolvido ao front-end.
#[tauri::command]
fn dev_seed_openrouter_key(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(not(all(debug_assertions, target_os = "android")))]
    let _ = &app;
    #[cfg(all(debug_assertions, target_os = "android"))]
    return app.pingo().dev_seed_key();
    #[cfg(all(debug_assertions, not(target_os = "android")))]
    {
        let entry = entry("openrouter_api_key")?;
        if entry.get_password().is_ok() {
            return Ok(false);
        }
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../.env.local");
        let Ok(text) = std::fs::read_to_string(path) else {
            return Ok(false);
        };
        for line in text.lines() {
            if let Some(value) = line.trim().strip_prefix("OPENROUTER_API_KEY=") {
                let value = value.trim().trim_matches('"');
                if !value.is_empty() {
                    entry.set_password(value).map_err(|e| e.to_string())?;
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    #[cfg(any(not(debug_assertions), target_os = "android"))]
    {
        Ok(false)
    }
}

/// Mostra a janela principal (criando o foco se ela estava escondida na bandeja).
#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Ícone na bandeja: o Pingo continua rodando (e avisando) com a janela fechada.
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItemBuilder::with_id("open", "Abrir o Pingo").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Sair").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;

    let mut tray = TrayIconBuilder::with_id("pingo")
        .tooltip("Pingo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pingo::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // Fala com o relay na AWS sem as regras de CORS do navegador; só para os endereços liberados na capability.
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        // Lembra as pastas que o usuário escolheu (backup automático) entre uma abertura e outra.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_sql::Builder::default().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--hidden"]),
    ));

    let app = builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                setup_tray(app)?;
                // Iniciado com o computador: abre escondido na bandeja.
                if std::env::args().any(|a| a == "--hidden") {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }
            #[cfg(not(desktop))]
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar a janela só a esconde; para sair de verdade, use a bandeja ou Cmd+Q.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete,
            shared_take,
            shared_read,
            shared_discard,
            os_reminders_sync,
            dev_log,
            dev_seed_openrouter_key
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // macOS: clicar no ícone do Dock com a janela escondida reabre o Pingo.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
