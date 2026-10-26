// Cadastro feito pelo administrador do grupo:
//  - criar: cria o usuário com senha temporária e já coloca no grupo
//  - meu-usuario: conta antiga (sem usuário) escolhe o próprio usuário uma única vez
//  - senha: define uma nova senha temporária, ex.: 12345678 (a pessoa troca no próximo acesso)
// O login usa "<usuario>@usuarios.rngroup.app" por baixo; a pessoa só digita o usuário.
import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { adminClient } from "../_shared/channels.ts";

const DOMAIN = "usuarios.rngroup.app";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

type Body =
  | { action: "criar"; group_id: string; username: string; password: string; can_pessoal?: boolean; can_empresa?: boolean; can_invite?: boolean }
  | { action: "senha"; group_id: string; user_id: string; password: string }
  | { action: "meu-usuario"; username: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "nao_autenticado" }, 401);

  const body = (await req.json()) as Body;
  const db = adminClient();

  if (body.action === "meu-usuario") {
    const username = String(body.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: "usuario_invalido" }, 400);
    const { data: me } = await db.from("profiles").select("username").eq("id", user.id).maybeSingle();
    if (me?.username) return json({ error: "ja_tem_usuario" }, 400);
    const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return json({ error: "usuario_em_uso" }, 409);
    const { error } = await db.auth.admin.updateUserById(user.id, { email: `${username}@${DOMAIN}`, email_confirm: true });
    if (error) {
      const dup = /already|registered|exists/i.test(error.message);
      return json({ error: dup ? "usuario_em_uso" : "falhou" }, dup ? 409 : 500);
    }
    await db.from("profiles").update({ username }).eq("id", user.id);
    return json({ ok: true, username });
  }

  // quem chama precisa ser administrador do grupo
  const { data: adm } = await db.from("group_members").select("id")
    .eq("group_id", body.group_id).eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!adm) return json({ error: "sem_permissao" }, 403);

  if (!body.password || body.password.length < 6) return json({ error: "senha_curta" }, 400);

  if (body.action === "criar") {
    const username = String(body.username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: "usuario_invalido" }, 400);
    const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return json({ error: "usuario_em_uso" }, 409);

    const { data: created, error } = await db.auth.admin.createUser({
      email: `${username}@${DOMAIN}`,
      password: body.password,
      email_confirm: true,
      user_metadata: { username, created_by: user.id },
    });
    if (error || !created.user) {
      const dup = /already|registered|exists/i.test(error?.message ?? "");
      return json({ error: dup ? "usuario_em_uso" : "falhou" }, dup ? 409 : 500);
    }
    const { error: gmErr } = await db.from("group_members").insert({
      group_id: body.group_id, user_id: created.user.id, role: "membro",
      can_pessoal: body.can_pessoal ?? true, can_empresa: body.can_empresa ?? true, can_invite: body.can_invite ?? true,
    });
    if (gmErr) {
      await db.auth.admin.deleteUser(created.user.id);
      return json({ error: "falhou" }, 500);
    }
    return json({ ok: true, user_id: created.user.id, username });
  }

  if (body.action === "senha") {
    // a pessoa precisa estar neste grupo e não pode ser administradora
    const { data: m } = await db.from("group_members").select("role")
      .eq("group_id", body.group_id).eq("user_id", body.user_id).maybeSingle();
    if (!m || m.role !== "membro") return json({ error: "sem_permissao" }, 403);
    const { error } = await db.auth.admin.updateUserById(body.user_id, { password: body.password });
    if (error) return json({ error: "falhou" }, 500);
    await db.from("profiles").update({ needs_setup: true }).eq("id", body.user_id);
    return json({ ok: true });
  }

  return json({ error: "acao_invalida" }, 400);
});
