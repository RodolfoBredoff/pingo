# Medições do piloto

Números colhidos no aparelho de teste (Redmi Note 11, Android 13). Sem conteúdo de mensagens. Alimentam o limite do plano gratuito e a escolha de modelos (design.md, Apêndice A: "a medir no piloto"). Valores em dólares, como o OpenRouter cobra.

## Custo por chamada de IA (27/11/2026)

Fonte: tabela `usage` do aparelho. Dados brutos locais em `.collected/2026-11-27/usage.csv` (fora do Git).

| Tipo | Modelo | Chamadas | Tokens de entrada (média) | Tokens de saída (média) | Custo médio |
|---|---|---|---|---|---|
| Texto | `openai/gpt-oss-120b` | 5 | 937 | 480 | US$ 0,000107 |
| Imagem (print) | `google/gemini-2.5-flash-lite` | 1 | 1.130 | 150 | US$ 0,000173 |
| PDF (capítulo de livro, longo) | `openai/gpt-5-nano` | 1 | **70.058** | 334 | **US$ 0,003636** |
| Áudio | | 0 | | | ainda não testado |

Total do dia: US$ 0,004343 em 7 chamadas.

**Leituras e cuidados**

- Texto fica perto de US$ 0,0001 por extração. As três últimas (mensagens curtas) custaram entre US$ 0,000044 e US$ 0,000056. Com a média de 937 tokens, mil extrações de texto custam cerca de US$ 0,11.
- **O PDF custou cerca de 34 vezes o texto** e gerou três cartões com confiança 0,1 a 0,2 e "quando" faltando. Era um capítulo de livro, não um recado. Pontos a tratar na Fase 8: limite de páginas, aviso antes de enviar um PDF grande, e uma checagem prévia do tipo "isto parece um recado ou compromisso?" para não gastar tokens (e não poluir a agenda) com documentos longos.
- Uma única amostra por tipo. Não fixar limite do plano gratuito com isso: precisamos de mais PDFs de tamanho normal (convite, aviso da escola de 1 a 2 páginas), fotos e áudios.
- O teto diário de US$ 0,25 e o mensal de US$ 4 (Ajustes) seguram um PDF grande por engano, mas não impedem vários seguidos num dia.

## Cobertura dos testes de 27/11/2026 à noite

| Teste | Resultado |
|---|---|
| Anexar imagem pelo clipe do app | OK: chamada de visão, cartão criado |
| Anexar PDF pelo clipe do app | OK, mas caro e com cartões de baixa confiança (ver acima) |
| Mensagens de texto digitadas | OK: três extrações, itens confirmados pelo dono |
| Compartilhar foto, PDF ou áudio **pelo menu do sistema** | **Não testado**: nenhuma linha `[share]` e nenhum intent `SEND` no log. Os anexos vieram do clipe do app |
| Compartilhar com o app fechado | Não testado |
| Áudio (qualquer caminho) | Não testado |
| Quedas ou ANR | Nenhuma (o único "has died" é do reinício do aparelho) |

O Pingo aparece como destino de Compartilhar para `text/plain`, `image/jpeg`, `application/pdf`, `audio/ogg` e `audio/mpeg` (conferido com `pm query-activities`).

## Estado do aparelho

- Pingo fora da lista de exceções do Doze (esperado; o alarme usa `setAndAllowWhileIdle`). MIUI V816. Sem "economia de bateria" global ligada.
- Alarmes sobreviveram a reinício (teste 6.3) e entregam em poucos minutos do horário.
