use keyring::Entry;

/// Nome do serviço no keychain do sistema (macOS Keychain, Credential Manager, Secret Service).
const SERVICE: &str = "br.com.pingo.app";

/// Apenas estes segredos podem ser lidos/gravados pelo front-end.
const ALLOWED_KEYS: &[&str] = &["openrouter_api_key", "relay_token", "spike_test"];

fn entry(key: &str) -> Result<Entry, String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err(format!("segredo não permitido: {key}"));
    }
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

/// Devolve `None` quando o segredo ainda não existe.
#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
fn dev_seed_openrouter_key() -> Result<bool, String> {
    #[cfg(debug_assertions)]
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
    #[cfg(not(debug_assertions))]
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
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
