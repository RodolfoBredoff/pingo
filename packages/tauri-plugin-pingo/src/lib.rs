//! Plugin nativo do Pingo. No Android guarda segredos no Android Keystore; no desktop não faz nada
//! (o app usa o keychain do sistema pela crate `keyring`).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
mod mobile;
#[cfg(target_os = "android")]
pub use mobile::{Pingo, ReminderItem};

/// `app.pingo()`: acesso ao plugin (só no Android).
#[cfg(target_os = "android")]
pub trait PingoExt<R: Runtime> {
    fn pingo(&self) -> &Pingo<R>;
}

#[cfg(target_os = "android")]
impl<R: Runtime, T: Manager<R>> PingoExt<R> for T {
    fn pingo(&self) -> &Pingo<R> {
        self.state::<Pingo<R>>().inner()
    }
}

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "br.com.pingo.plugin";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pingo")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "PingoPlugin")?;
                app.manage(Pingo::new(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
