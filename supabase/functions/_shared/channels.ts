// Canais de entrega dos alertas: push no celular e Telegram.
// O Telegram só envia quando TELEGRAM_BOT_TOKEN estiver configurado
// e a pessoa tiver conectado a conta dela (telegram_chat_id).
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "npm:web-push@3.6.7";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.109.0";

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

let vapidReady = false;
function initVapid() {
  if (vapidReady) return true;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@rngroup.app", pub, priv);
  vapidReady = true;
  return true;
}

export type Message = {
  title: string;
  body: string;
  url?: string;     // abre esta tela ao tocar
  tag?: string;     // substitui notificação anterior com a mesma tag
  itemId?: string;
  speak?: string;   // texto para leitura em voz (resumo do dia)
};

/** Envia para todos os aparelhos e canais de uma pessoa. */
export async function deliver(db: SupabaseClient, userId: string, msg: Message) {
  const out = { push: 0, telegram: false };
  if (initVapid()) {
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId);
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 3600, urgency: "high" },
        );
        out.push++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push falhou", code, String(e));
      }
    }
  }
  const { data: prof } = await db.from("profiles").select("telegram_chat_id, telegram_on").eq("id", userId).maybeSingle();
  if (prof?.telegram_on && prof.telegram_chat_id) {
    out.telegram = await sendTelegram(prof.telegram_chat_id, `*${escapeMd(msg.title)}*\n${escapeMd(msg.body)}`);
  }
  return out;
}

export async function sendTelegram(chatId: number | string, text: string): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return false; // Telegram ainda não ativado
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2" }),
  });
  if (!r.ok) console.error("telegram falhou", r.status, await r.text());
  return r.ok;
}

export const escapeMd = (s: string) => s.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c);

/** Grava a chave e devolve true só na primeira vez (evita alerta duplicado). */
export async function firstTime(db: SupabaseClient, userId: string, key: string) {
  const { error } = await db.from("notification_log").insert({ user_id: userId, key });
  return !error;
}

// ---------- datas no fuso da pessoa ----------
export function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, weekday: p.weekday, day: +p.day, month: +p.month };
}

export function quando(due: Date, tz: string, now = new Date()) {
  const mins = Math.round((due.getTime() - now.getTime()) / 60000);
  const hm = localParts(due, tz).hm;
  if (mins <= 0) return `agora (${hm})`;
  if (mins < 60) return `em ${mins} min (${hm})`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return `em ${h} h${m ? ` ${m} min` : ""} (${hm})`;
  }
  return `amanhã às ${hm}`;
}

export const KIND_LABEL: Record<string, string> = { tarefa: "Tarefa", lembrete: "Lembrete", reuniao: "Reunião" };
