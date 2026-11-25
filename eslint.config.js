import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cdk.out/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      // protótipo descartável do PWA: scripts de navegador e de service worker
      'apps/pwa-lab/public/**',
      'apps/pwa-lab/scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/pingo/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // O core não pode depender de Tauri nem de AWS (regra do projeto).
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@tauri-apps/*'], message: 'O core não pode importar Tauri.' },
            {
              group: ['@aws-sdk/*', 'aws-cdk-lib', 'aws-cdk-lib/*'],
              message: 'O core não pode importar AWS.',
            },
          ],
        },
      ],
    },
  },
)
