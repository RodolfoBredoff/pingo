# Pingo Lab (protótipo descartável de PWA)

Valida no celular se o Pingo funcionaria como PWA (aplicativo web instalável), sem cabo e sem Android Studio. **Não é o app do Pingo.** Serve para decidir entre PWA e app nativo (ver `.kiro/specs/pingo/tasks.md`, Fase 6B).

## O que testa
1. Instalação como app e armazenamento permanente.
2. Compartilhar → Pingo (Web Share Target), com o app fechado e aberto: texto, foto, PDF e nota de voz do WhatsApp.
3. Push agendado (30 s, 2 min, 10 min) com o app fechado. O push leva só o id; o texto sai do banco local.
4. SQLite no navegador (WASM + OPFS) persistindo entre aberturas.
5. Microfone e decodificação de áudio (inclui OGG/Opus).

Tudo o que acontece no celular é enviado ao servidor e aparece no terminal e em `.lab/log.jsonl`.

## Como rodar (3 passos)
```
pnpm --filter @pingo/pwa-lab start                                     # servidor em :8787 (mantém o Mac acordado)
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787         # túnel HTTPS temporário; copie a URL https://....trycloudflare.com
pnpm --filter @pingo/pwa-lab link https://....trycloudflare.com         # imprime o link com a chave e gera .lab/qr.svg
```
A URL do túnel muda a cada vez. Como o app instalado e a inscrição de push pertencem a um endereço, **depois de trocar de túnel é preciso reinstalar o app no celular** (desinstale o antigo antes).

## Verificação no computador (Chrome sem tela)
`pnpm --filter @pingo/pwa-lab check` (servidor ligado): banco, service worker, Compartilhar simulado, inscrição de push. O Chrome sem tela não recebe push; a entrega real só se prova no celular.

## Segurança
- O servidor escuta só em `127.0.0.1`; só o túnel o expõe, e só enquanto estiver rodando.
- As rotas que mexem em algo exigem a chave (`.lab/key.json`, ignorada pelo git). A chave viaja no `#` do link, que o navegador não envia ao servidor.
- Chaves VAPID e inscrição ficam em `.lab/` (ignorada pelo git). O laboratório não toca em nenhuma chave real (nem OpenRouter, nem AWS).
- Encerre o túnel e o servidor ao terminar.

## Estado
- Verificado no Chrome do Mac em 24/11/2026: SQLite/OPFS, service worker, Compartilhar simulado, inscrição de push (FCM aceitou o envio, 201).
- **Falta o teste no celular** (roteiro em `tasks.md`, Fase 6B).
