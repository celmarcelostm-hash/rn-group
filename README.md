# RN Group

App de tarefas, lembretes e reuniões, separado em **Pessoal** (verde) e **Empresa** (azul).
Funciona no celular como aplicativo instalado (PWA) e manda notificações mesmo com o app fechado.

## O que o app faz

- **Tarefas, lembretes e reuniões** com dia, horário e repetição (todo dia, dias úteis, toda semana, todo mês).
- **Criar por voz**: "reunião com João amanhã às 15h sobre o orçamento" vira uma reunião pronta, com dia, horário, categoria e convidados.
- **Reuniões com convidados por e-mail**: quem tem conta recebe o convite e os alertas; quem ainda não tem recebe quando criar a conta com o mesmo e-mail. Também dá para mandar o convite pelo WhatsApp.
- **Confirmação de presença** ("Vou participar" / "Não posso").
- **Reagendar com motivo**: o novo horário e o motivo ficam visíveis para todos, com histórico de mudanças, e os participantes confirmam de novo.
- **Pedir novo horário**: o convidado sugere outro horário com motivo; o organizador aceita ou mantém.
- **Estou atrasado**: avisa os participantes na hora (5, 10, 15, 30 min ou 1 h, com mensagem).
- **Pauta e ata** da reunião.
- **Alertas programáveis** por item: 1 dia, 4 h, 2 h, 1 h, 30 min, 10 min antes ou na hora (padrão: 4 h, 1 h e 10 min).
- **Lembrar em 10 min** direto na notificação.
- **Resumo do dia** no horário escolhido (padrão 7h), com leitura em áudio.
- **Telegram** preparado: fica desligado até o robô ser criado.

## Como está organizado

| Parte | Onde | O que faz |
|---|---|---|
| App (telas) | `index.html`, `src/` | Vite + JavaScript, instalável (PWA) |
| Service worker | `public/sw.js` | Recebe o push e abre o app no item certo |
| Banco de dados | `supabase/migrations/` | Postgres com segurança por pessoa (cada um só vê o que participa) |
| Alertas | `supabase/functions/send-alerts` | Roda a cada minuto: alertas, soneca, resumo do dia, reuniões que se repetem |
| Avisos na hora | `supabase/functions/notify` | Convite, reagendamento, pedido de horário, atraso, presença, cancelamento |
| Telegram | `supabase/functions/telegram-webhook` | Conecta a conta do Telegram (desligado até ter o robô) |

Sem as variáveis do Supabase, o app abre em **modo demonstração** (dados só no aparelho, sem notificações).

## Colocar no ar

### 1. Supabase (banco, login e push)

1. Crie um projeto em [supabase.com](https://supabase.com) (região **South America (São Paulo)**).
2. Em **SQL Editor**, rode o arquivo `supabase/migrations/20261025000000_init.sql`.
   (ou, com a CLI: `npx supabase link --project-ref SEU-PROJETO` e `npx supabase db push`)
3. Gere as chaves do push: `npx web-push generate-vapid-keys`.
4. Publique as funções e cadastre os segredos:
   ```bash
   npx supabase functions deploy send-alerts notify telegram-webhook
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:seu@email.com CRON_SECRET=um-segredo-longo
   ```
5. No **SQL Editor**, rode `supabase/setup_cron.sql` trocando `SEU-PROJETO` e `SEU-SEGREDO`.
6. Em **Authentication → URL Configuration**, coloque o endereço do app (o da Vercel) em **Site URL**.

### 2. Vercel (hospedagem)

1. Em [vercel.com](https://vercel.com), importe este repositório (framework: **Vite**).
2. Cadastre as variáveis:
   - `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Supabase → Project Settings → API)
   - `VITE_VAPID_PUBLIC_KEY` (a chave pública do passo 1.3)
   - `VITE_TELEGRAM_BOT` (deixe vazio por enquanto)
3. Publique. Abra o endereço no celular e instale:
   - **Android (Chrome)**: toque em **Instalar** no aviso do app.
   - **iPhone (Safari, iOS 16.4 ou mais novo)**: **Compartilhar → Adicionar à Tela de Início**. Abra pelo ícone e ative as notificações no Perfil.

### 3. Telegram (quando quiser ligar)

1. No Telegram, fale com **@BotFather**, crie o robô e copie o token.
2. `npx supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=outro-segredo`
3. Registre o webhook:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://SEU-PROJETO.supabase.co/functions/v1/telegram-webhook&secret_token=outro-segredo`
4. Na Vercel, preencha `VITE_TELEGRAM_BOT` com o nome do robô (sem @) e publique de novo.
5. No app, Perfil → Telegram → **Conectar**.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha ou deixe vazio para o modo demonstração
npm run dev
npm test                     # testes do interpretador de voz e da repetição
```
