// Chamado pelo app logo depois de uma ação que outras pessoas precisam saber:
// convite, reagendamento, pedido de novo horário, resposta, "estou atrasado",
// confirmação de presença e cancelamento.
import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { adminClient, deliver, localParts } from "../_shared/channels.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

type Body = { item_id: string; type: string; to_user?: string; minutes?: number; reason?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });

  // quem está chamando
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "não autenticado" }, 401);

  const body = (await req.json()) as Body;
  const db = adminClient();
  const { data: item } = await db.from("items").select("*").eq("id", body.item_id).maybeSingle();
  if (!item) return json({ error: "item não encontrado" }, 404);
  const { data: members } = await db.from("item_members").select("*").eq("item_id", item.id);
  const me = (members ?? []).find((m) => m.user_id === user.id);
  if (!me) return json({ error: "sem acesso" }, 403);

  const { data: myProf } = await db.from("profiles").select("name, timezone").eq("id", user.id).maybeSingle();
  const who = myProf?.name || user.email || "Alguém";
  const tz = myProf?.timezone || "America/Sao_Paulo";
  const others = (members ?? []).filter((m) => m.user_id && m.user_id !== user.id);
  const when = item.due_at ? fmt(item.due_at, tz) : "sem data";

  let targets: string[] = [];
  let title = "", text = "";
  switch (body.type) {
    case "convite":
      targets = others.filter((m) => m.rsvp === "pendente").map((m) => m.user_id);
      title = "Novo convite de reunião";
      text = `${who} convidou você: ${item.title} · ${when}`;
      break;
    case "reagendada":
      targets = others.map((m) => m.user_id);
      title = "Reunião mudou de horário";
      text = `${item.title}: agora ${when}${body.reason ? ` · Motivo: ${body.reason}` : ""}. Confirme de novo.`;
      break;
    case "pedido":
      targets = [item.owner].filter((id) => id !== user.id);
      title = "Pedido de novo horário";
      text = `${who} pediu para mudar "${item.title}"${body.reason ? ` · Motivo: ${body.reason}` : ""}`;
      break;
    case "pedido_resposta":
      targets = body.to_user ? [body.to_user] : [];
      title = "Resposta ao seu pedido";
      text = `${item.title}: ${body.reason ?? ""}`;
      break;
    case "atraso":
      targets = others.map((m) => m.user_id);
      title = `${who} vai se atrasar`;
      text = `${item.title}${body.minutes ? ` · cerca de ${body.minutes} min` : ""}${body.reason ? ` · ${body.reason}` : ""}`;
      break;
    case "rsvp":
      targets = [item.owner].filter((id) => id !== user.id);
      title = me.rsvp === "sim" ? `${who} confirmou presença` : `${who} não vai participar`;
      text = `${item.title} · ${when}`;
      break;
    case "cancelada":
      if (item.owner !== user.id) return json({ error: "só o organizador cancela" }, 403);
      targets = others.map((m) => m.user_id);
      title = "Reunião cancelada";
      text = `${item.title} · ${when}`;
      break;
    default:
      return json({ error: "tipo desconhecido" }, 400);
  }

  // só avisa quem participa do item
  const allowed = new Set((members ?? []).map((m) => m.user_id));
  const results = [];
  for (const uid of [...new Set(targets)].filter((u) => allowed.has(u))) {
    results.push(await deliver(db, uid, { title, body: text, url: body.type === "cancelada" ? "/" : `/?item=${item.id}`, tag: `item-${item.id}`, itemId: item.id }));
  }
  return json({ ok: true, enviados: results.length });
});

function fmt(iso: string, tz: string) {
  const d = new Date(iso);
  const p = localParts(d, tz);
  const today = localParts(new Date(), tz).ymd;
  const tomorrow = localParts(new Date(Date.now() + 86400_000), tz).ymd;
  const day = p.ymd === today ? "hoje" : p.ymd === tomorrow ? "amanhã" : `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`;
  return `${day} às ${p.hm}`;
}
