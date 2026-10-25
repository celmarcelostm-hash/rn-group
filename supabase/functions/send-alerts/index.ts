// Roda a cada minuto (pg_cron). Envia:
//  - alertas programados de cada item (ex.: 4 h, 1 h e 10 min antes)
//  - "lembrar de novo" (soneca)
//  - resumo do dia no horário escolhido por cada pessoa
// e avança reuniões que se repetem depois que passam.
import { adminClient, deliver, firstTime, KIND_LABEL, localParts, quando } from "../_shared/channels.ts";
import { nextOccurrence } from "../_shared/recurrence.ts";

const WINDOW = 10 * 60_000; // se o servidor atrasar, ainda envia dentro de 10 min

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });

  const db = adminClient();
  const now = new Date();
  const sent: string[] = [];

  // ---------- 1. alertas e soneca ----------
  const from = new Date(now.getTime() - 15 * 60_000).toISOString();
  const to = new Date(now.getTime() + 1450 * 60_000).toISOString();
  const { data: rows, error } = await db
    .from("item_members")
    .select("id, user_id, rsvp, done, snooze_until, items!inner(id, title, kind, cat, place, due_at, all_day, alerts)")
    .not("user_id", "is", null)
    .eq("done", false)
    .neq("rsvp", "nao")
    .gte("items.due_at", from)
    .lte("items.due_at", to);
  if (error) return new Response(JSON.stringify(error), { status: 500 });

  const userIds = [...new Set((rows ?? []).map((r) => r.user_id as string))];
  const { data: profs } = userIds.length
    ? await db.from("profiles").select("id, default_alerts, timezone").in("id", userIds)
    : { data: [] };
  const profOf = new Map((profs ?? []).map((p) => [p.id, p]));

  for (const r of rows ?? []) {
    // deno-lint-ignore no-explicit-any
    const it = (r as any).items;
    if (!it?.due_at || it.all_day) continue;
    const p = profOf.get(r.user_id) ?? { default_alerts: [240, 60, 10], timezone: "America/Sao_Paulo" };
    const due = new Date(it.due_at);
    const offsets: number[] = (it.alerts ?? p.default_alerts ?? []).slice().sort((a: number, b: number) => a - b);
    for (const off of offsets) {
      const t = due.getTime() - off * 60_000;
      if (now.getTime() >= t && now.getTime() < t + WINDOW) {
        const key = `a:${it.id}:${it.due_at}:${off}`;
        if (await firstTime(db, r.user_id, key)) {
          await deliver(db, r.user_id, {
            title: `${KIND_LABEL[it.kind]} ${quando(due, p.timezone, now)}`,
            body: it.title + (it.place ? ` · ${it.place}` : ""),
            url: `/?item=${it.id}`,
            tag: `item-${it.id}`,
            itemId: it.id,
          });
          sent.push(key);
        }
        break; // um alerta por item por rodada
      }
    }
  }

  // soneca ("lembrar em 10 min")
  const { data: snz } = await db
    .from("item_members")
    .select("id, user_id, snooze_until, items!inner(id, title, kind, due_at)")
    .not("user_id", "is", null)
    .eq("done", false)
    .gte("snooze_until", new Date(now.getTime() - WINDOW).toISOString())
    .lte("snooze_until", now.toISOString());
  for (const r of snz ?? []) {
    // deno-lint-ignore no-explicit-any
    const it = (r as any).items;
    const key = `s:${r.id}:${r.snooze_until}`;
    if (await firstTime(db, r.user_id, key)) {
      await deliver(db, r.user_id, { title: `Lembrete: ${KIND_LABEL[it.kind]}`, body: it.title, url: `/?item=${it.id}`, tag: `item-${it.id}`, itemId: it.id });
      sent.push(key);
    }
  }

  // ---------- 2. resumo do dia ----------
  const { data: briefProfs } = await db.from("profiles").select("id, name, timezone, brief_time").eq("brief_on", true);
  for (const p of briefProfs ?? []) {
    const lp = localParts(now, p.timezone);
    const [bh, bm] = String(p.brief_time).split(":").map(Number);
    const [nh, nm] = lp.hm.split(":").map(Number);
    const diff = (nh * 60 + nm) - (bh * 60 + bm);
    if (diff < 0 || diff >= 10) continue;
    const key = `b:${lp.ymd}`;
    if (!(await firstTime(db, p.id, key))) continue;
    const text = await buildBrief(db, p, now);
    await deliver(db, p.id, { title: "Resumo do dia", body: text.short, url: "/?resumo=1", tag: "resumo", speak: text.full });
    sent.push(`${key}:${p.id}`);
  }

  // ---------- 3. reuniões que se repetem ----------
  const { data: rec } = await db
    .from("items")
    .select("id, due_at, recurrence")
    .not("recurrence", "is", null)
    .eq("kind", "reuniao")
    .lt("due_at", new Date(now.getTime() - 2 * 3600_000).toISOString());
  for (const it of rec ?? []) {
    const next = nextOccurrence(it.due_at, it.recurrence, now);
    await db.from("items").update({ due_at: next }).eq("id", it.id);
    await db.from("item_members").update({ done: false, snooze_until: null }).eq("item_id", it.id);
  }

  return new Response(JSON.stringify({ ok: true, sent: sent.length }), { headers: { "content-type": "application/json" } });
});

// deno-lint-ignore no-explicit-any
async function buildBrief(db: any, p: { id: string; name: string; timezone: string }, now: Date) {
  const lp = localParts(now, p.timezone);
  const { data } = await db
    .from("item_members")
    .select("rsvp, done, items!inner(id, title, kind, cat, place, due_at, all_day)")
    .eq("user_id", p.id)
    .eq("done", false)
    .neq("rsvp", "nao")
    .gte("items.due_at", new Date(now.getTime() - 30 * 86400_000).toISOString())
    .lte("items.due_at", new Date(now.getTime() + 36 * 3600_000).toISOString());
  // deno-lint-ignore no-explicit-any
  const its = (data ?? []).map((r: any) => r.items).filter(Boolean);
  // deno-lint-ignore no-explicit-any
  const today = its.filter((x: any) => localParts(new Date(x.due_at), p.timezone).ymd === lp.ymd)
    // deno-lint-ignore no-explicit-any
    .sort((a: any, b: any) => a.due_at.localeCompare(b.due_at));
  // deno-lint-ignore no-explicit-any
  const late = its.filter((x: any) => new Date(x.due_at) < now && localParts(new Date(x.due_at), p.timezone).ymd !== lp.ymd);
  // deno-lint-ignore no-explicit-any
  const meetings = today.filter((x: any) => x.kind === "reuniao").length;
  const nome = (p.name || "").split(" ")[0];
  const lines = [`Bom dia${nome ? ", " + nome : ""}. Hoje, ${lp.weekday}.`];
  if (!today.length) lines.push("Você não tem nada marcado para hoje.");
  else {
    lines.push(`Você tem ${meetings} ${meetings === 1 ? "reunião" : "reuniões"} e ${today.length - meetings} ${today.length - meetings === 1 ? "tarefa" : "tarefas"}.`);
    for (const x of today) {
      const hm = x.all_day ? "Durante o dia" : `Às ${localParts(new Date(x.due_at), p.timezone).hm}`;
      lines.push(`${hm}: ${x.title}${x.place ? ", em " + x.place : ""}.`);
    }
  }
  if (late.length) lines.push(`${late.length} ${late.length === 1 ? "pendência atrasada" : "pendências atrasadas"}.`);
  const short = today.length
    ? `${today.length} ${today.length === 1 ? "compromisso" : "compromissos"} hoje${late.length ? ` · ${late.length} atrasada(s)` : ""}. Toque para ouvir.`
    : `Dia livre${late.length ? ` · ${late.length} atrasada(s)` : ""}. Toque para ouvir.`;
  return { full: lines.join("\n"), short };
}
