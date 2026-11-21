import { invoke } from '@tauri-apps/api/core'

/** Chaves permitidas no lado Rust (src-tauri/src/lib.rs). */
export type SecretKey = 'openrouter_api_key' | 'relay_token' | 'spike_test'

/** Armazenamento seguro do sistema (macOS Keychain, Credential Manager, Secret Service). */
export const secrets = {
  set: (key: SecretKey, value: string) => invoke<void>('secret_set', { key, value }),
  get: (key: SecretKey) => invoke<string | null>('secret_get', { key }),
  delete: (key: SecretKey) => invoke<void>('secret_delete', { key }),
}
