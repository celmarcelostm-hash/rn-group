// Robô do Telegram (preparado, fica desligado até TELEGRAM_BOT_TOKEN ser configurado).
// A pessoa toca em "Conectar Telegram" no app, que abre t.me/<robô>?start=<código>.
// O robô recebe "/start <código>", acha o perfil e guarda o chat para enviar os alertas.
import { adminClient, sendTelegram } from "../_shared/channels.ts";

Deno.serve(async (req) => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return new Response("telegram desativado", { status: 200 });
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("forbidden", { status: 403 });

  const update = await req.json();
  const msg = update.message;
  if (!msg?.text) return new Response("ok");
  const chatId = msg.chat.id;
  const db = adminClient();

  const m = msg.text.match(/^\/start\s+([a-f0-9]{12})$/i);
  if (m) {
    const { data: prof } = await db.from("profiles").select("id, name").eq("telegram_link_code", m[1].toLowerCase()).maybeSingle();
    if (!prof) {
      await sendTelegram(chatId, "Não encontrei sua conta\\. Abra o RN Group, vá em Perfil e toque em *Conectar Telegram* de novo\\.");
      return new Response("ok");
    }
    await db.from("profiles").update({
      telegram_chat_id: chatId,
      telegram_user: msg.from?.username ? "@" + msg.from.username : null,
      telegram_on: true,
    }).eq("id", prof.id);
    await sendTelegram(chatId, "Pronto\\! Seus alertas do *RN Group* vão chegar aqui também\\.");
    return new Response("ok");
  }

  if (/^\/parar/i.test(msg.text)) {
    await db.from("profiles").update({ telegram_on: false }).eq("telegram_chat_id", chatId);
    await sendTelegram(chatId, "Alertas pelo Telegram desligados\\. Para voltar, use Conectar Telegram no app\\.");
    return new Response("ok");
  }

  await sendTelegram(chatId, "Eu envio os alertas do RN Group\\. Para conectar, use o botão *Conectar Telegram* no Perfil do app\\. Para desligar, mande /parar\\.");
  return new Response("ok");
});
