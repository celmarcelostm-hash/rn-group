// Acesso aos dados. Usa o Supabase quando as variáveis estão configuradas;
// sem elas, roda em "modo demonstração" guardando tudo neste aparelho.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isCloud = Boolean(URL && KEY);

function cloudApi() {
  const sb = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const api = {
    mode: 'cloud',
    uid: null,
    email: null,
    async session() {
      const { data } = await sb.auth.getSession();
      const u = data.session?.user || null;
      api.uid = u?.id || null; api.email = u?.email || null;
      return u;
    },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => { api.uid = s?.user?.id || null; api.email = s?.user?.email || null; cb(s?.user || null); }); },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async signUp(name, email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin } });
      if (error) throw error;
      return { needsConfirm: !data.session };
    },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?senha=1' }); if (error) throw error; },
    async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; },
    async signOut() { await sb.auth.signOut(); },

    async afterLogin() {
      await sb.rpc('claim_invites');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await sb.from('profiles').update({ timezone: tz }).eq('id', api.uid);
    },
    async loadProfile() {
      const { data, error } = await sb.from('profiles').select('*').eq('id', api.uid).maybeSingle();
      if (error) throw error;
      return data;
    },
    async updateProfile(patch) { const { error } = await sb.from('profiles').update(patch).eq('id', api.uid); if (error) throw error; },

    async loadAll() {
      const { data: items, error } = await sb.from('items')
        .select('*, item_members(*), reschedules(*), reschedule_requests(*), notices(*)')
        .order('due_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      const ids = [...new Set(items.flatMap((i) => i.item_members.map((m) => m.user_id)).concat(items.flatMap((i) => i.reschedules.map((r) => r.by))).filter(Boolean))];
      let profiles = [];
      if (ids.length) { const r = await sb.from('profiles').select('id, name, email').in('id', ids); profiles = r.data || []; }
      return { items, profiles };
    },
    subscribe(cb) {
      let t;
      const fire = () => { clearTimeout(t); t = setTimeout(cb, 300); };
      const ch = sb.channel('rn-group');
      for (const table of ['items', 'item_members', 'reschedules', 'reschedule_requests', 'notices', 'groups', 'group_members']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
      }
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },

    async createItem(item, invites = []) {
      const { data, error } = await sb.from('items').insert({ ...item, owner: api.uid }).select('id').single();
      if (error) throw error;
      if (invites.length) await api.addMembers(data.id, invites);
      return data.id;
    },
    async addMembers(itemId, invites) {
      const rows = [];
      for (const inv of invites) {
        const email = (inv.email || '').trim().toLowerCase();
        if (!email) { if (inv.name) rows.push({ item_id: itemId, user_id: null, email: null, name: inv.name }); continue; }
        const { data } = await sb.rpc('find_user_by_email', { p_email: email });
        const hit = data && data[0];
        if (hit?.id === api.uid) continue;
        rows.push({ item_id: itemId, user_id: hit?.id || null, email, name: inv.name || '' });
      }
      if (rows.length) { const { error } = await sb.from('item_members').insert(rows); if (error) throw error; }
      return rows.length;
    },
    async removeMember(memberId) { const { error } = await sb.from('item_members').delete().eq('id', memberId); if (error) throw error; },
    async updateItem(id, patch) { const { error } = await sb.from('items').update(patch).eq('id', id); if (error) throw error; },
    async deleteItem(id) { const { error } = await sb.from('items').delete().eq('id', id); if (error) throw error; },
    async updateMember(memberId, patch) { const { error } = await sb.from('item_members').update(patch).eq('id', memberId); if (error) throw error; },
    async resetRsvp(itemId) { await sb.from('item_members').update({ rsvp: 'pendente' }).eq('item_id', itemId).neq('role', 'dono'); },
    async addReschedule(itemId, from_at, to_at, reason) {
      const { error } = await sb.from('reschedules').insert({ item_id: itemId, from_at, to_at, reason, by: api.uid }); if (error) throw error;
    },
    async requestReschedule(itemId, to_at, reason) {
      const { error } = await sb.from('reschedule_requests').insert({ item_id: itemId, to_at, reason, by: api.uid }); if (error) throw error;
    },
    async resolveRequest(reqId, status) { const { error } = await sb.from('reschedule_requests').update({ status }).eq('id', reqId); if (error) throw error; },
    async addNotice(itemId, minutes, message) {
      const { error } = await sb.from('notices').insert({ item_id: itemId, minutes, message, by: api.uid }); if (error) throw error;
    },
    async notify(itemId, type, extra = {}) {
      try { await sb.functions.invoke('notify', { body: { item_id: itemId, type, ...extra } }); } catch (e) { console.warn('aviso não enviado', e); }
    },
    async savePush(sub) {
      const j = sub.toJSON();
      const { error } = await sb.from('push_subscriptions').upsert(
        { user_id: api.uid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
        { onConflict: 'endpoint' });
      if (error) throw error;
    },
    async getConfig(key) {
      const { data } = await sb.from('app_config').select('value').eq('key', key).maybeSingle();
      return data?.value || null;
    },
    async removePush(endpoint) { await sb.from('push_subscriptions').delete().eq('endpoint', endpoint); },

    // ----- grupos -----
    async loadGroups() {
      const { data, error } = await sb.from('groups').select('*, group_members(*)').order('created_at');
      if (error) throw error;
      const ids = [...new Set(data.flatMap((g) => g.group_members.map((m) => m.user_id)).filter(Boolean))];
      let profiles = [];
      if (ids.length) { const r = await sb.from('profiles').select('id, name, email').in('id', ids); profiles = r.data || []; }
      return { groups: data, profiles };
    },
    async createGroup(name) {
      const { data, error } = await sb.from('groups').insert({ name, created_by: api.uid }).select('id').single();
      if (error) throw error;
      return data.id;
    },
    async updateGroup(id, patch) { const { error } = await sb.from('groups').update(patch).eq('id', id); if (error) throw error; },
    async deleteGroup(id) { const { error } = await sb.from('groups').delete().eq('id', id); if (error) throw error; },
    async addGroupMember(groupId, email, perms) {
      email = email.trim().toLowerCase();
      const { data } = await sb.rpc('find_user_by_email', { p_email: email });
      const hit = data && data[0];
      const { error } = await sb.from('group_members').insert({ group_id: groupId, user_id: hit?.id || null, email, role: 'membro', ...perms });
      if (error) throw error;
      return !!hit;
    },
    async updateGroupMember(id, patch) { const { error } = await sb.from('group_members').update(patch).eq('id', id); if (error) throw error; },
    async updateAllGroupMembers(groupId, patch) {
      const { error } = await sb.from('group_members').update(patch).eq('group_id', groupId).eq('role', 'membro'); if (error) throw error;
    },
    async removeGroupMember(id) { const { error } = await sb.from('group_members').delete().eq('id', id); if (error) throw error; },
  };
  return api;
}

// ---------- modo demonstração (sem servidor) ----------
function demoApi() {
  const KEYS = 'rng.demo';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEYS)) || null; } catch { return null; } };
  let db = load() || { profile: null, items: [], members: [], reschedules: [], reschedule_requests: [], notices: [] };
  db.groups ||= []; db.gmembers ||= [];
  const save = () => { try { localStorage.setItem(KEYS, JSON.stringify(db)); } catch { /* sem espaço */ } listeners.forEach((f) => f()); };
  const listeners = new Set();
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const now = () => new Date().toISOString();
  const api = {
    mode: 'demo', uid: 'demo', email: 'voce@exemplo.com',
    async session() { return db.profile ? { id: 'demo' } : null; },
    onAuth() {},
    async signIn() { api._ensure(); },
    async signUp(name) { api._ensure(name); return { needsConfirm: false }; },
    _ensure(name = '') {
      if (!db.profile) db.profile = { id: 'demo', name, email: api.email, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, default_alerts: [240, 60, 10], brief_on: true, brief_time: '07:00', telegram_user: '', telegram_on: false, telegram_link_code: 'demo' };
      save();
    },
    async resetPassword() {}, async setPassword() {},
    async signOut() { localStorage.removeItem(KEYS); db = { profile: null, items: [], members: [], reschedules: [], reschedule_requests: [], notices: [], groups: [], gmembers: [] }; },
    async afterLogin() {},
    async loadProfile() { return db.profile; },
    async updateProfile(p) { Object.assign(db.profile, p); save(); },
    async loadAll() {
      const items = db.items.map((i) => ({
        ...i,
        item_members: db.members.filter((m) => m.item_id === i.id),
        reschedules: db.reschedules.filter((m) => m.item_id === i.id),
        reschedule_requests: db.reschedule_requests.filter((m) => m.item_id === i.id),
        notices: db.notices.filter((m) => m.item_id === i.id),
      }));
      return { items, profiles: [{ id: 'demo', name: db.profile?.name || '', email: api.email }] };
    },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async createItem(item, invites = []) {
      const it = { id: id(), owner: 'demo', notes: '', place: '', agenda: '', minutes: '', alerts: null, recurrence: null, all_day: false, created_at: now(), updated_at: now(), ...item };
      db.items.push(it);
      db.members.push({ id: id(), item_id: it.id, user_id: 'demo', email: api.email, name: '', role: 'dono', rsvp: 'sim', done: false, snooze_until: null });
      await api.addMembers(it.id, invites);
      save(); return it.id;
    },
    async addMembers(itemId, invites) {
      for (const inv of invites) db.members.push({ id: id(), item_id: itemId, user_id: null, email: (inv.email || '').toLowerCase() || null, name: inv.name || '', role: 'convidado', rsvp: 'pendente', done: false, snooze_until: null });
      save(); return invites.length;
    },
    async removeMember(mid) { db.members = db.members.filter((m) => m.id !== mid); save(); },
    async updateItem(iid, p) { Object.assign(db.items.find((i) => i.id === iid) || {}, p, { updated_at: now() }); save(); },
    async deleteItem(iid) { for (const k of ['items']) db[k] = db[k].filter((x) => x.id !== iid); for (const k of ['members', 'reschedules', 'reschedule_requests', 'notices']) db[k] = db[k].filter((x) => x.item_id !== iid); save(); },
    async updateMember(mid, p) { Object.assign(db.members.find((m) => m.id === mid) || {}, p); save(); },
    async resetRsvp(iid) { db.members.filter((m) => m.item_id === iid && m.role !== 'dono').forEach((m) => { m.rsvp = 'pendente'; }); save(); },
    async addReschedule(item_id, from_at, to_at, reason) { db.reschedules.push({ id: id(), item_id, from_at, to_at, reason, by: 'demo', created_at: now() }); save(); },
    async requestReschedule(item_id, to_at, reason) { db.reschedule_requests.push({ id: id(), item_id, to_at, reason, by: 'demo', status: 'aberto', created_at: now() }); save(); },
    async resolveRequest(rid, status) { Object.assign(db.reschedule_requests.find((r) => r.id === rid) || {}, { status }); save(); },
    async addNotice(item_id, minutes, message) { db.notices.push({ id: id(), item_id, minutes, message, by: 'demo', kind: 'atraso', created_at: now() }); save(); },
    async notify() {},
    async savePush() {}, async removePush() {}, async getConfig() { return null; },
    async loadGroups() {
      return { groups: db.groups.map((g) => ({ ...g, group_members: db.gmembers.filter((m) => m.group_id === g.id) })), profiles: [] };
    },
    async createGroup(name) {
      const g = { id: id(), name, created_by: 'demo', can_pessoal: true, can_empresa: true, can_invite: true, created_at: now() };
      db.groups.push(g);
      db.gmembers.push({ id: id(), group_id: g.id, user_id: 'demo', email: api.email, role: 'admin', can_pessoal: true, can_empresa: true, can_invite: true, created_at: now() });
      save(); return g.id;
    },
    async updateGroup(gid, p) { Object.assign(db.groups.find((g) => g.id === gid) || {}, p); save(); },
    async deleteGroup(gid) { db.groups = db.groups.filter((g) => g.id !== gid); db.gmembers = db.gmembers.filter((m) => m.group_id !== gid); save(); },
    async addGroupMember(gid, email, perms) {
      email = email.trim().toLowerCase();
      if (db.gmembers.some((m) => m.group_id === gid && m.email === email)) throw new Error('duplicate key');
      db.gmembers.push({ id: id(), group_id: gid, user_id: null, email, role: 'membro', can_pessoal: true, can_empresa: true, can_invite: true, ...perms, created_at: now() });
      save(); return false;
    },
    async updateGroupMember(mid, p) { Object.assign(db.gmembers.find((m) => m.id === mid) || {}, p); save(); },
    async updateAllGroupMembers(gid, p) { db.gmembers.filter((m) => m.group_id === gid && m.role === 'membro').forEach((m) => Object.assign(m, p)); save(); },
    async removeGroupMember(mid) { db.gmembers = db.gmembers.filter((m) => m.id !== mid); save(); },
  };
  return api;
}

export const api = isCloud ? cloudApi() : demoApi();
