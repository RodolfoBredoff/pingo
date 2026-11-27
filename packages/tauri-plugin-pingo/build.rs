// Comandos expostos ao JavaScript (nenhum por enquanto: o cofre é chamado só pelo Rust do app,
// que confere a lista de chaves permitidas antes).
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
