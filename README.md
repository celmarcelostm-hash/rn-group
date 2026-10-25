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

O servidor é instalado sozinho pelo GitHub (arquivo `.github/workflows/servidor.yml`).
Você só cria as contas e cola três valores.

### 1. Supabase (banco, login e notificações)

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo:
   nome **rn-group**, região **South America (São Paulo)**. Anote a **senha do banco** que você escolher.
2. Copie o **Project ref**: é o código do endereço do projeto (`https://supabase.com/dashboard/project/ESTE-CODIGO`).
3. Crie um token em [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) (nome: `github`).

### 2. GitHub (instala o servidor)

No repositório: **Settings → Secrets and variables → Actions → New repository secret**. Crie:

| Nome | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | o token do passo 1.3 |
| `SUPABASE_PROJECT_REF` | o código do passo 1.2 |
| `SUPABASE_DB_PASSWORD` | a senha do banco do passo 1.1 |

Depois vá em **Actions → Servidor (Supabase) → Run workflow**. Em uns 3 minutos o servidor fica pronto:
banco, segurança, chaves do push, agendador de alertas (a cada minuto) e funções.

### 3. Vercel (o app no ar)

1. Em [vercel.com/new](https://vercel.com/new), entre com o GitHub e importe o **rn-group** (framework: Vite).
2. Em **Environment Variables**, cadastre (Supabase → Project Settings → API):
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = chave **anon public**
3. Clique em **Deploy** e copie o endereço do app (ex.: `https://rn-group.vercel.app`).
4. No GitHub, em **Settings → Secrets and variables → Actions → Variables**, crie `APP_URL` com esse endereço
   e rode o **Servidor (Supabase)** de novo (assim os links de e-mail do login abrem o app).

### 4. No celular

- **Android (Chrome)**: abra o endereço e toque em **Instalar**.
- **iPhone (Safari, iOS 16.4+)**: **Compartilhar → Adicionar à Tela de Início**, abra pelo ícone.
- Crie sua conta, vá em **Perfil → Notificação no celular → Ativar** e toque em **Testar alerta**.

### Telegram (quando quiser ligar)

1. No Telegram, fale com **@BotFather**, crie o robô e copie o token.
2. No GitHub, crie os segredos `TELEGRAM_BOT_TOKEN` (o token) e `TELEGRAM_WEBHOOK_SECRET` (uma senha qualquer, só letras e números) e rode o **Servidor (Supabase)**.
3. Na Vercel, crie `VITE_TELEGRAM_BOT` com o nome do robô (sem @) e publique de novo.
4. No app: **Perfil → Telegram → Conectar**.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha ou deixe vazio para o modo demonstração
npm run dev
npm test                     # testes do interpretador de voz e da repetição
```
