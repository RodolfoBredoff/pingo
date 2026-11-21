import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import process from 'node:process'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  // Opções do Vite para o Tauri (aplicadas em `tauri dev` e `tauri build`)
  clearScreen: false, // não esconder erros do Rust
  server: {
    port: 1420, // o Tauri espera porta fixa
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
}))
