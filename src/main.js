import './style.css';
import { api } from './api.js';
import { parseFala } from './parser.js';
import { nextOccurrence, RECURRENCE, recurrenceLabel } from './recurrence.js';
import { permsFor, ALL } from './perms.js';
import { cpfValido, mascaraCpf, soNumeros, usuarioValido, senhaForte } from './cpf.js';
import { registerSW, pushStatus, enablePush, disablePush, refreshPush, isIOS, isStandalone } from './push.js';

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const DIAS_L = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } },
};
const BOT = import.meta.env.VITE_TELEGRAM_BOT;
const ICON = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l5 5 9-10"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
};

/* ---------- datas: banco (ISO) <-> tela (local) ---------- */
const toLocal = (iso, allDay) => {
  if (!iso) return null;
  const d = new Date(iso);
  return allDay ? ymd(d) : `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (date, time) => {
  if (!date) return { due_at: null, all_day: false };
  return time ? { due_at: new Date(`${date}T${time}`).toISOString(), all_day: false } : { due_at: new Date(`${date}T12:00`).toISOString(), all_day: true };
};
const timeOf = (d) => (d && d.includes('T') ? d.slice(11, 16) : '');
function whenLabel(due) {
  if (!due) return 'Sem data';
  const d = new Date(due.length === 10 ? due + 'T12:00' : due);
  const today = ymd(new Date()); const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const day = due.slice(0, 10) === today ? 'Hoje' : due.slice(0, 10) === ymd(tm) ? 'Amanhã' : `${pad(d.getDate())} ${MESES[d.getMonth()]}`;
  return timeOf(due) ? `${day}, ${timeOf(due)}` : day;
}
const isoLabel = (iso) => whenLabel(toLocal(iso, false));

/* ---------- estado ---------- */
const S = {
  user: null, profile: null, items: [], people: {}, sel: ymd(new Date()), filter: 'todas', filter2: 'todas', view: 'hoje',
  push: 'indisponivel', installEvt: null, loaded: false, groups: [], perms: { ...ALL },
};
const me = () => api.uid;
const defAlerts = () => S.profile?.default_alerts || [240, 60, 10];

function normalize(raw) {
  const members = raw.item_members || [];
  const my = members.find((m) => m.user_id === api.uid) || members.find((m) => m.email && m.email === (api.email || '').toLowerCase()) || null;
  return {
    ...raw,
    members,
    my,
    isOwner: raw.owner === api.uid,
    done: !!my?.done,
    rsvp: my?.rsvp || 'pendente',
    due: toLocal(raw.due_at, raw.all_day),
    history: (raw.reschedules || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    requests: (raw.reschedule_requests || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    notices: (raw.notices || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}
async function reload() {
  try {
    const [{ items, profiles }, gr] = await Promise.all([api.loadAll(), api.loadGroups().catch((e) => { console.warn(e); return null; })]);
    S.items = items.map(normalize);
    for (const p of profiles) S.people[p.id] = p;
    if (gr) { S.groups = gr.groups; for (const p of gr.profiles) S.people[p.id] = p; S.perms = permsFor(S.groups, api.uid); }
    S.loaded = true;
    render();
    openFromUrl();
  } catch (e) {
    console.error(e);
    toast('Não foi possível carregar seus dados. Verifique a internet.');
  }
}
const visible = () => S.items.filter((x) => x.isOwner || x.rsvp !== 'nao');
const personName = (m) => {
  if (m.user_id && m.user_id === api.uid) return 'Você';
  const p = m.user_id && S.people[m.user_id];
  return (p && p.name) || m.name || (m.email ? m.email.split('@')[0] : '') || 'Participante';
};
const nameOf = (uid) => (uid === api.uid ? 'Você' : S.people[uid]?.name || 'Participante');

function status(it) {
  if (!it.due || it.done) return null;
  const end = it.due.length === 10 ? new Date(it.due + 'T23:59') : new Date(it.due);
  const diff = (end - Date.now()) / 60000;
  if (diff < 0) return 'late';
  if (it.due.length > 10 && diff <= 120) return 'soon';
  return null;
}
const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9');

/* ---------- render ---------- */
function render() {
  if (!S.user) return;
  renderBanners(); renderWeek(); renderCounts(); renderDay(); renderUndated(); renderAgenda(); renderInvites(); renderProfile(); renderBrief(); renderPerms(); renderGroups();
}
function renderBanners() {
  const b = [];
  if (api.mode === 'demo') b.push(`<div class="banner"><span>Modo demonstração: os dados ficam só neste aparelho e não há notificações.</span></div>`);
  if (S.installEvt) b.push(`<div class="banner"><span>Instale o RN Group no celular para receber os alertas.</span><button class="ghost" id="installBtn">Instalar</button></div>`);
  else if (isIOS && !isStandalone() && api.mode === 'cloud') b.push(`<div class="banner"><span>No iPhone: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b> para receber notificações.</span></div>`);
  else if (S.push === 'desligado') b.push(`<div class="banner"><span>Ative as notificações para os alertas chegarem com o app fechado.</span><button class="ghost" data-push>Ativar</button></div>`);
  $('#banners').innerHTML = b.join('');
}
function renderWeek() {
  const sel = new Date(S.sel + 'T12:00'); const mon = new Date(sel); mon.setDate(sel.getDate() - ((sel.getDay() + 6) % 7));
  const its = visible();
  let h = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i); const k = ymd(d);
    const has = its.some((x) => x.due && x.due.startsWith(k) && !x.done);
    h += `<button class="day ${k === S.sel ? 'sel' : ''}" data-day="${k}" aria-label="${DIAS_L[d.getDay()]} ${d.getDate()}"><small>${DIAS[d.getDay()]}</small><span>${d.getDate()}</span>${has && k !== S.sel ? '<i></i>' : ''}</button>`;
  }
  $('#week').innerHTML = h;
  const t = new Date(S.sel + 'T12:00');
  $('#dayTitle').textContent = S.sel === ymd(new Date()) ? 'Seu dia' : `${DIAS_L[t.getDay()][0].toUpperCase() + DIAS_L[t.getDay()].slice(1)}, ${t.getDate()} ${MESES[t.getMonth()]}`;
}
function renderCounts() {
  const its = visible().filter((x) => !x.done);
  const n = (c) => its.filter((x) => x.cat === c).length;
  const lbl = (k) => `${k} pendente${k === 1 ? '' : 's'}`;
  $('#cnt-p').textContent = lbl(n('pessoal')); $('#cnt-e').textContent = lbl(n('empresa'));
}
function itemHTML(it, showDay) {
  const st = status(it);
  const cat = it.cat === 'empresa' ? '<span class="k-e">Empresa</span>' : '<span class="k-p">Pessoal</span>';
  const kind = it.kind === 'reuniao' ? '<span class="tag">Reunião</span>' : it.kind === 'lembrete' ? '<span class="tag">Lembrete</span>' : '';
  const when = showDay ? whenLabel(it.due) : timeOf(it.due) ? (it.due.slice(0, 10) === ymd(new Date()) ? 'Hoje, ' : '') + timeOf(it.due) : 'Dia todo';
  const last = it.history[it.history.length - 1];
  const openReq = it.isOwner ? it.requests.filter((r) => r.status === 'aberto').length : 0;
  const lateNote = it.notices.find((n) => Date.now() - new Date(n.created_at) < 3 * 3600_000);
  let pill = '';
  if (st === 'late') pill = `<span class="pill late">${ICON.clock}Atrasada</span>`;
  else if (openReq) pill = '<span class="pill inv">Pedido de mudança</span>';
  else if (it.kind === 'reuniao' && !it.isOwner && it.rsvp === 'pendente') pill = last ? '<span class="pill soon">Novo horário</span>' : '<span class="pill inv">Convite</span>';
  else if (st === 'soon') pill = `<span class="pill soon">${ICON.clock}Em breve</span>`;
  const ppl = it.kind === 'reuniao' ? `<span>·</span><span>${ICON.people} ${it.members.length}</span>` : '';
  const rec = it.recurrence ? `<span class="rec-tag">${ICON.repeat}${esc(recurrenceLabel(it.recurrence))}</span>` : '';
  const resch = last ? `<div class="resch">Reagendada: <s>${esc(isoLabel(last.from_at))}</s> → ${esc(isoLabel(last.to_at))} · Motivo: ${esc(last.reason)}</div>` : '';
  const ln = lateNote ? `<div class="notice">${esc(nameOf(lateNote.by))} vai se atrasar${lateNote.minutes ? ` ${lateNote.minutes} min` : ''}${lateNote.message ? ': ' + esc(lateNote.message) : ''}</div>` : '';
  return `<div class="item ${st || ''} ${it.done ? 'done' : ''}" data-id="${esc(it.id)}">
    <button class="chk" aria-label="${it.done ? 'Desmarcar' : 'Concluir'} ${esc(it.title)}">${ICON.check}</button>
    <div class="body"><div class="t">${esc(it.title)}</div><div class="meta">${cat}<span>·</span><span>${esc(when)}</span>${ppl}${kind}${rec}</div>${it.place ? `<div class="where">Local: ${esc(it.place)}</div>` : ''}${ln}${resch}</div>
    ${pill}<button class="more" aria-label="Abrir ${esc(it.title)}">${ICON.dots}</button></div>`;
}
function renderDay() {
  const its = visible().filter((x) => x.due && x.due.startsWith(S.sel) && (S.filter === 'todas' || x.cat === S.filter)).sort(byDue);
  $('#dayList').innerHTML = its.length ? its.map((x) => itemHTML(x, false)).join('')
    : `<div class="empty"><div>${S.loaded ? 'Nada marcado para este dia' + (S.filter !== 'todas' ? ' em ' + (S.filter === 'pessoal' ? 'Pessoal' : 'Empresa') : '') + '.' : 'Carregando…'}</div>
       ${S.loaded && !S.items.length ? '<div class="note">Crie sua primeira tarefa nos botões acima ou fale pelo microfone.</div>' : ''}</div>`;
}
function renderUndated() {
  const its = visible().filter((x) => !x.due && (S.filter === 'todas' || x.cat === S.filter));
  $('#undated').innerHTML = its.length ? `<div class="list">${its.map((x) => itemHTML(x, true)).join('')}</div>` : '<div class="note" style="font-size:14px">Nenhuma tarefa sem data.</div>';
}
function renderAgenda() {
  const now = new Date(); const lim = new Date(); lim.setDate(lim.getDate() + 30);
  const its = visible().filter((x) => x.due && (S.filter2 === 'todas' || x.cat === S.filter2) && new Date(x.due.slice(0, 10) + 'T00:00') <= lim).sort(byDue);
  const late = its.filter((x) => status(x) === 'late');
  const rest = its.filter((x) => status(x) !== 'late' && x.due.slice(0, 10) >= ymd(now));
  const groups = {}; rest.forEach((x) => { (groups[x.due.slice(0, 10)] ||= []).push(x); });
  let h = '';
  if (late.length) h += `<div class="agenda-day"><h3 style="color:var(--red)">Atrasadas</h3><div class="list">${late.map((x) => itemHTML(x, true)).join('')}</div></div>`;
  for (const k of Object.keys(groups).sort()) {
    const d = new Date(k + 'T12:00');
    const lbl = k === ymd(now) ? 'Hoje' : `${DIAS_L[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()]}`;
    h += `<div class="agenda-day"><h3>${lbl}</h3><div class="list">${groups[k].map((x) => itemHTML(x, false)).join('')}</div></div>`;
  }
  $('#agendaList').innerHTML = h || '<div class="list"><div class="empty">Nenhum compromisso nos próximos 30 dias.</div></div>';
}
function peopleHTML(it) {
  return `<div class="people">${it.members.map((m) => {
    const r = m.role === 'dono' ? 'ok' : m.rsvp === 'sim' ? 'ok' : m.rsvp === 'nao' ? 'no' : '';
    const nm = personName(m);
    const extra = m.role === 'dono' ? ' (organizador)' : !m.user_id ? (m.email ? ' (convite por e-mail)' : ' (fora do app)') : m.rsvp === 'pendente' ? ' (aguardando)' : '';
    return `<span class="person ${r}"><span class="av">${esc(nm[0] || '?')}</span>${esc(nm)}<span class="note">${extra}</span></span>`;
  }).join('')}</div>`;
}
function histHTML(it, n = 99) {
  return it.history.slice(-n).reverse().map((h) => `<div><b>${esc(isoLabel(h.from_at))} → ${esc(isoLabel(h.to_at))}</b><br>${esc(h.reason)}<br><small>${esc(nameOf(h.by))} · ${new Date(h.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('');
}
function requestsHTML(it) {
  return it.requests.filter((r) => r.status === 'aberto').map((r) => `<div class="req"><div><b>${esc(nameOf(r.by))}</b> pediu para mudar para <b>${esc(isoLabel(r.to_at))}</b><br>Motivo: ${esc(r.reason)}</div>
    ${it.isOwner ? `<div class="inv-actions"><button class="btn" data-acc="${esc(r.id)}" style="padding:8px">Aceitar novo horário</button><button class="btn no" data-ign="${esc(r.id)}" style="padding:8px">Manter</button></div>` : '<span class="note">Aguardando o organizador</span>'}</div>`).join('');
}
function renderInvites() {
  const meetings = S.items.filter((x) => x.kind === 'reuniao');
  const inn = meetings.filter((m) => !m.isOwner).sort(byDue);
  const out = meetings.filter((m) => m.isOwner).sort(byDue);
  const card = (m, incoming) => {
    const r = m.rsvp;
    const conf = m.members.filter((x) => x.role !== 'dono' && x.rsvp === 'sim').length;
    const guests = m.members.filter((x) => x.role !== 'dono').length;
    return `<div class="inv-card" style="--c:${m.cat === 'empresa' ? 'var(--blue)' : 'var(--green)'}" data-mid="${esc(m.id)}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div style="min-width:0"><div class="t">${esc(m.title)}</div><div class="meta"><span class="${m.cat === 'empresa' ? 'k-e' : 'k-p'}">${m.cat === 'empresa' ? 'Empresa' : 'Pessoal'}</span><span>·</span><span>${esc(whenLabel(m.due))}</span>${m.recurrence ? `<span class="rec-tag">${ICON.repeat}${esc(recurrenceLabel(m.recurrence))}</span>` : ''}</div></div>
      ${incoming ? (r === 'sim' ? '<span class="pill ok" style="color:var(--green-ink)">Confirmado</span>' : r === 'nao' ? '<span class="pill late">Recusado</span>' : m.history.length ? '<span class="pill soon">Novo horário: confirme</span>' : '<span class="pill inv">Aguardando você</span>') : `<span class="pill ok">${conf}/${guests} confirmados</span>`}</div>
      ${m.place ? `<div class="where">Local: ${esc(m.place)}</div>` : ''}
      ${m.notices[0] && Date.now() - new Date(m.notices[0].created_at) < 3 * 3600_000 ? `<div class="notice">${esc(nameOf(m.notices[0].by))} vai se atrasar${m.notices[0].minutes ? ` ${m.notices[0].minutes} min` : ''}</div>` : ''}
      ${m.history.length ? `<div class="hist">${histHTML(m, 1)}</div>` : ''}
      ${requestsHTML(m)}
      ${peopleHTML(m)}
      ${incoming ? `<div class="inv-actions"><button class="btn" style="--c:var(--green)" data-rsvp="sim">Vou participar</button><button class="btn no" data-rsvp="nao">Não posso</button></div>`
        : `<div class="inv-actions"><button class="ghost" data-open>Detalhes</button>${S.perms.convite ? '<button class="ghost" data-share>Enviar convite</button>' : ''}</div>`}
    </div>`;
  };
  $('#invIn').innerHTML = inn.length ? inn.map((m) => card(m, true)).join('') : '<div class="list"><div class="empty">Nenhum convite recebido.</div></div>';
  $('#invOut').innerHTML = out.length ? out.map((m) => card(m, false)).join('') : '<div class="list"><div class="empty">Você ainda não marcou reuniões.</div></div>';
  const pend = inn.filter((m) => m.rsvp === 'pendente').length + out.reduce((n, m) => n + m.requests.filter((r) => r.status === 'aberto').length, 0);
  $('#invBadge').hidden = !pend; $('#invBadge').textContent = pend;
}
function renderProfile() {
  const its = visible();
  $('#sPend').textContent = its.filter((x) => !x.done).length;
  $('#sDone').textContent = its.filter((x) => x.done).length;
  $('#sMeet').textContent = its.filter((x) => x.kind === 'reuniao').length;
  const name = S.profile?.name || '';
  $('#pName').textContent = name || 'Você';
  $('#pAv').textContent = (name || api.email || '?')[0].toUpperCase();
  $('#pMail').textContent = [S.profile?.username ? 'Usuário: ' + S.profile.username : '', S.profile?.email || (api.mode === 'demo' ? 'Modo demonstração' : '')].filter(Boolean).join(' · ');
  if (document.activeElement !== $('#pNameIn')) $('#pNameIn').value = name;
  $('#hello').textContent = name ? `Olá, ${name.split(' ')[0]}` : 'Olá!';
  $('#defAlerts').innerHTML = alertChips(defAlerts());
  $('#briefOn').checked = S.profile?.brief_on ?? true;
  if (document.activeElement !== $('#briefTime')) $('#briefTime').value = String(S.profile?.brief_time || '07:00').slice(0, 5);
  // push
  const PN = {
    ativo: ['Ativas neste aparelho', 'Desligar'], desligado: ['Chega mesmo com o app fechado', 'Ativar'],
    bloqueado: ['Bloqueadas. Libere nas configurações do navegador para este site.', ''],
    instalar: ['No iPhone, primeiro adicione o app à Tela de Início', ''],
    indisponivel: [api.mode === 'demo' ? 'Disponível quando o app estiver conectado ao servidor' : 'Este navegador não recebe notificações', ''],
  }[S.push];
  $('#pushNote').textContent = PN[0];
  $('#pushBtn').hidden = !PN[1]; $('#pushBtn').textContent = PN[1];
  $('#pushBtn').classList.toggle('no', S.push === 'ativo');
  // telegram
  const tgOn = !!S.profile?.telegram_on;
  if (!BOT || api.mode === 'demo') { $('#tgBtn').textContent = 'Em breve'; $('#tgBtn').disabled = true; $('#tgNote').textContent = 'Receba os alertas numa conversa com o robô do RN Group'; }
  else if (tgOn) { $('#tgBtn').textContent = 'Desligar'; $('#tgBtn').disabled = false; $('#tgNote').textContent = `Conectado${S.profile.telegram_user ? ' como ' + S.profile.telegram_user : ''}`; }
  else { $('#tgBtn').textContent = 'Conectar'; $('#tgBtn').disabled = false; $('#tgNote').textContent = 'Toque em Conectar e depois em Começar no Telegram'; }
  const note = api.mode === 'cloud' ? 'Sincronizado com sua conta. Convites e alertas chegam para todos os participantes.' : 'Modo demonstração: seus registros ficam neste aparelho.';
  $('#modeNote').textContent = note; $('#modeNote2').textContent = note;
}

/* ---------- permissões e grupos ---------- */
function renderPerms() {
  const P = S.perms;
  $$('[data-new="pessoal"],[data-new="empresa"]').forEach((b) => {
    const ok = P[b.dataset.new];
    b.disabled = !ok; b.classList.toggle('off', !ok);
    b.lastChild.textContent = ok ? 'Criar tarefa' : 'Sem acesso';
  });
  const any = P.pessoal || P.empresa;
  $('#voiceBtn').hidden = !any;
  $$('[data-new="reuniao"]').forEach((b) => { b.hidden = !any; });
}
const PERMS = [['can_pessoal', 'Pessoal', 'p'], ['can_empresa', 'Empresa', 'e'], ['can_invite', 'Convites', 'y']];
const gmName = (m) => {
  if (m.user_id === api.uid) return 'Você';
  const p = m.user_id && S.people[m.user_id];
  return (p && (p.name || p.username)) || m.username || m.email || 'Membro';
};
const gmInfo = (m) => {
  if (m.role === 'admin') return 'Administrador · acesso total';
  const p = m.user_id && S.people[m.user_id];
  const user = p?.username || m.username;
  if (!m.user_id) return 'Aguardando criar a conta';
  return [user ? 'Usuário: ' + user : p?.email || m.email || '', p?.needs_setup ?? !p ? 'Aguardando primeiro acesso' : ''].filter(Boolean).join(' · ');
};
const canReset = (m) => m.role !== 'admin' && !!m.user_id;
function renderGroups() {
  const box = $('#groupsList'); if (!box) return;
  $('#newGroup').hidden = !!S.profile?.created_by;
  if (!S.groups.length) {
    box.innerHTML = '<p class="note" style="margin:0">Crie um grupo para a sua equipe. Como administrador, você escolhe quem pode criar tarefas em Pessoal, em Empresa e quem pode enviar convites.</p>';
    return;
  }
  box.innerHTML = S.groups.map((g) => {
    const mine = g.group_members.find((m) => m.user_id === api.uid);
    const admin = mine?.role === 'admin';
    const members = g.group_members.slice().sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0));
    if (!admin) {
      const adm = members.filter((m) => m.role === 'admin').map(gmName).join(', ');
      const can = mine ? PERMS.filter(([k]) => mine[k]).map(([, l]) => l) : [];
      return `<div class="grp"><div class="grp-h"><b>${esc(g.name)}</b><span class="pill inv">Membro</span></div>
        <div class="note">Administrador: ${esc(adm || '—')}</div>
        <div class="note">Você pode: ${can.length ? esc(can.join(', ').replace('Convites', 'enviar convites')) : 'só ver e concluir o que receber'}</div></div>`;
    }
    const chip = (attr, on, l, c) => `<button type="button" class="opt ${c} sm" ${attr} aria-pressed="${!!on}">${l}</button>`;
    return `<div class="grp" data-gid="${esc(g.id)}">
      <div class="grp-h"><b>${esc(g.name)}</b><span class="pill ok">Administrador</span></div>
      <div class="f"><span>Todos os membros podem criar ou enviar:</span><div class="chips">${PERMS.map(([k, l, c]) => chip(`data-gall="${k}"`, g[k], l, c)).join('')}</div></div>
      <div class="gm-list">${members.map((m) => `<div class="gm" data-gmid="${esc(m.id)}">
        <div class="gm-n"><span class="av">${esc(gmName(m)[0].toUpperCase())}</span><div style="min-width:0"><div class="t1">${esc(gmName(m))}</div><div class="note">${esc(gmInfo(m))}</div></div>
        ${canReset(m) ? '<button type="button" class="link" data-gmpass style="font-size:13px;white-space:nowrap">Nova senha</button>' : ''}
        ${m.role === 'admin' ? '' : `<button type="button" class="chipx" data-gmrm aria-label="Remover ${esc(gmName(m))}">✕</button>`}</div>
        ${m.role === 'admin' ? '' : `<div class="chips">${PERMS.map(([k, l, c]) => chip(`data-gperm="${k}"`, m[k], l, c)).join('')}</div>`}
      </div>`).join('')}</div>
      <button type="button" class="btn" data-gnew style="padding:12px">+ Adicionar pessoa</button>
      <button type="button" class="link" data-gdel style="color:var(--red);align-self:flex-start">Excluir grupo</button>
    </div>`;
  }).join('');
}
function groupSheet() {
  const el = sheet('Criar grupo', `
    <label class="f">Nome do grupo<input class="inp" id="gName" required maxlength="60" placeholder="Ex.: Equipe RN Group"></label>
    <p class="note" style="margin:0">Você será o administrador. Depois é só adicionar as pessoas pelo e-mail e escolher o que cada uma pode fazer.</p>
    <button class="btn" type="submit" style="padding:14px">Criar grupo</button>`, { form: true });
  el.onsubmit = safe(async (e) => {
    e.preventDefault(); const name = $('#gName').value.trim(); if (!name) return;
    await api.createGroup(name); closeSheet(); toast('Grupo criado. Agora adicione as pessoas.'); await reload();
  });
  setTimeout(() => $('#gName')?.focus(), 60);
}
async function groupClick(t) {
  if (t.closest('#newGroup')) { groupSheet(); return true; }
  const host = t.closest('[data-gid]'); if (!host) return false;
  const g = S.groups.find((x) => x.id === host.dataset.gid); if (!g) return true;
  const all = t.closest('[data-gall]');
  if (all) {
    const k = all.dataset.gall, v = !g[k];
    await api.updateGroup(g.id, { [k]: v }); await api.updateAllGroupMembers(g.id, { [k]: v });
    toast(`${PERMS.find((x) => x[0] === k)[1]}: ${v ? 'liberado' : 'bloqueado'} para todos os membros`); await reload(); return true;
  }
  const row = t.closest('[data-gmid]'); const m = row && g.group_members.find((x) => x.id === row.dataset.gmid);
  const pm = t.closest('[data-gperm]');
  if (pm && m) { const k = pm.dataset.gperm; await api.updateGroupMember(m.id, { [k]: !m[k] }); await reload(); return true; }
  if (t.closest('[data-gmrm]') && m) {
    sheet('Remover do grupo?', `<p style="margin:0">${esc(gmName(m))} sai do grupo “${esc(g.name)}”.</p><div class="inv-actions"><button class="btn" id="cYes" style="--c:var(--red)">Remover</button><button class="btn no" id="cNo">Voltar</button></div>`);
    $('#cNo').onclick = closeSheet;
    $('#cYes').onclick = safe(async () => { await api.removeGroupMember(m.id); closeSheet(); toast('Removido do grupo'); await reload(); });
    return true;
  }
  if (t.closest('[data-gnew]')) { newUserSheet(g); return true; }
  if (t.closest('[data-gmpass]') && m) { resetPassSheet(g, m); return true; }
  if (t.closest('[data-gdel]')) {
    sheet('Excluir grupo?', `<p style="margin:0">O grupo “${esc(g.name)}” será apagado e os membros voltam a ter acesso livre. As tarefas e reuniões não são apagadas.</p><div class="inv-actions"><button class="btn" id="cYes" style="--c:var(--red)">Excluir grupo</button><button class="btn no" id="cNo">Voltar</button></div>`);
    $('#cNo').onclick = closeSheet;
    $('#cYes').onclick = safe(async () => { await api.deleteGroup(g.id); closeSheet(); toast('Grupo excluído'); await reload(); });
    return true;
  }
  return true;
}
const TEMP_PASS = '12345678';
function credSheet(title, user, pass, novo) {
  const txt = `Seu acesso ao RN Group\nEndereço: ${location.origin}\nUsuário: ${user}\nSenha temporária: ${pass}\n\nNo primeiro acesso você completa seu cadastro e cria sua senha.`;
  sheet(title, `
    <p style="margin:0">${novo ? 'Usuário criado e já colocado no grupo.' : 'Senha temporária definida.'} Envie os dados de acesso para a pessoa:</p>
    <div class="share" id="crTxt">${esc(txt)}</div>
    <div class="actions"><a class="btn" style="--c:#1FA855;text-decoration:none" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar no WhatsApp</a><button class="ghost" id="crCopy">Copiar</button></div>`);
  $('#crCopy').onclick = () => copy(txt, $('#crTxt'));
}
function newUserSheet(g) {
  const perms = { can_pessoal: g.can_pessoal, can_empresa: g.can_empresa, can_invite: g.can_invite };
  const el = sheet('Adicionar pessoa', `
    <p class="note" style="margin:0">Você cria o usuário e uma senha temporária. No primeiro acesso a pessoa completa nome, e-mail, CPF e cria a própria senha.</p>
    <label class="f">Usuário<input class="inp" id="nuUser" required maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Ex.: joao.silva"></label>
    <span class="note" style="margin-top:-6px">Letras minúsculas, números, ponto, hífen ou _. Não pode ser mudado depois.</span>
    <label class="f">Senha temporária<input class="inp" id="nuPass" required minlength="6" value="${TEMP_PASS}" autocomplete="off"></label>
    <div class="f"><span>Pode criar ou enviar</span><div class="chips" id="nuPerms">${PERMS.map(([k, l, c]) => `<button type="button" class="opt ${c} sm" data-k="${k}" aria-pressed="${!!perms[k]}">${l}</button>`).join('')}</div></div>
    <p class="err" id="nuErr" hidden></p>
    <button class="btn" type="submit" style="padding:14px">Criar usuário</button>`, { form: true });
  $('#nuUser').oninput = (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s/g, ''); };
  $('#nuPerms').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; perms[b.dataset.k] = !perms[b.dataset.k]; b.setAttribute('aria-pressed', perms[b.dataset.k]); };
  const fail = (m) => { $('#nuErr').textContent = m; $('#nuErr').hidden = false; };
  el.onsubmit = async (e) => {
    e.preventDefault();
    const user = $('#nuUser').value.trim(), pass = $('#nuPass').value.trim();
    if (!usuarioValido(user)) return fail('Usuário inválido: use de 3 a 30 letras minúsculas, números, ponto, hífen ou _ (sem acento e sem espaço).');
    if (pass.length < 6) return fail('A senha temporária precisa ter pelo menos 6 caracteres.');
    const btn = $('#sheet button[type=submit]'); btn.disabled = true;
    try {
      await api.adminUsers({ action: 'criar', group_id: g.id, username: user, password: pass, ...perms });
      await reload(); credSheet('Pessoa adicionada', user, pass, true);
    } catch (err) {
      btn.disabled = false;
      const c = String(err?.message || err);
      fail(c.includes('usuario_em_uso') ? 'Este usuário já existe. Escolha outro.' : c.includes('sem_permissao') ? 'Só o administrador do grupo pode adicionar pessoas.' : 'Não foi possível criar. Verifique a internet e tente de novo.');
    }
  };
  setTimeout(() => $('#nuUser')?.focus(), 60);
}
function resetPassSheet(g, m) {
  const user = S.people[m.user_id]?.username || m.username || '';
  const el = sheet('Nova senha temporária', `
    <p style="margin:0">${esc(gmName(m))} vai entrar com esta senha e, em seguida, criar uma nova.</p>
    <label class="f">Senha temporária<input class="inp" id="rpPass" required minlength="6" value="${TEMP_PASS}" autocomplete="off"></label>
    <p class="err" id="rpErr" hidden></p>
    <button class="btn" type="submit" style="padding:14px">Definir senha</button>`, { form: true });
  el.onsubmit = async (e) => {
    e.preventDefault();
    const pass = $('#rpPass').value.trim();
    if (pass.length < 6) { $('#rpErr').textContent = 'A senha precisa ter pelo menos 6 caracteres.'; $('#rpErr').hidden = false; return; }
    try { await api.adminUsers({ action: 'senha', group_id: g.id, user_id: m.user_id, password: pass }); await reload(); credSheet('Senha redefinida', user, pass, false); }
    catch { $('#rpErr').textContent = 'Não foi possível redefinir. Tente de novo.'; $('#rpErr').hidden = false; }
  };
}
function confirmLogout() {
  sheet('Sair da conta?', `<p style="margin:0">${api.mode === 'demo' ? 'No modo demonstração, os dados deste aparelho serão apagados.' : 'Para voltar, é só entrar de novo com seu e-mail e senha. As notificações deste aparelho param até você entrar de novo.'}</p>
    <div class="inv-actions"><button class="btn" id="cYes" style="--c:var(--red)">Sair</button><button class="btn no" id="cNo">Voltar</button></div>`);
  $('#cNo').onclick = closeSheet;
  $('#cYes').onclick = safe(async () => { if (S.push === 'ativo') await disablePush().catch(() => {}); await api.signOut(); location.reload(); });
}

/* ---------- alertas (escolha) ---------- */
const ALERTAS = [[1440, '1 dia antes'], [240, '4 h antes'], [120, '2 h antes'], [60, '1 h antes'], [30, '30 min antes'], [10, '10 min antes'], [0, 'Na hora']];
const alertChips = (sel) => ALERTAS.map(([v, l]) => `<button type="button" class="opt y" data-al="${v}" aria-pressed="${sel.includes(v)}">${l}</button>`).join('');
const alertsOf = (it) => (Array.isArray(it.alerts) ? it.alerts : defAlerts());

/* ---------- navegação, toast ---------- */
function go(v) {
  S.view = v; $$('.view').forEach((el) => { el.hidden = el.id !== 'v-' + v; });
  $$('.nav button').forEach((b) => { if (b.dataset.go === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
}
let toastT;
function toast(msg, ms = 3200, action) {
  $('.toast')?.remove(); clearTimeout(toastT);
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  const sp = document.createElement('span'); sp.textContent = msg; t.appendChild(sp);
  if (action) { const b = document.createElement('button'); b.className = 'ta'; b.textContent = action.label; b.onclick = () => { t.remove(); action.run(); }; t.appendChild(b); }
  document.body.appendChild(t); toastT = setTimeout(() => t.remove(), ms);
}
const layer = () => $('#layer');
const closeSheet = () => { layer().innerHTML = ''; };
function sheet(title, inner, { form = false } = {}) {
  const tag = form ? 'form' : 'div';
  layer().innerHTML = `<div class="scrim" id="scrim"><${tag} class="sheet" id="sheet" autocomplete="off">
    <div class="sheet-h"><h2>${title}</h2><button type="button" class="x" id="fx" aria-label="Fechar">✕</button></div>${inner}</${tag}></div>`;
  $('#fx').onclick = closeSheet;
  $('#scrim').onclick = (e) => { if (e.target.id === 'scrim') closeSheet(); };
  return $('#sheet');
}
const errMsg = (e) => {
  const m = String(e?.message || e);
  if (/sem_permissao_convite/.test(m)) return 'O administrador do grupo não liberou o envio de convites para você.';
  if (/sem_permissao_pessoal/.test(m)) return 'O administrador do grupo não liberou criar em Pessoal para você.';
  if (/sem_permissao_empresa/.test(m)) return 'O administrador do grupo não liberou criar em Empresa para você.';
  if (/duplicate key|unique/i.test(m)) return 'Isso já está cadastrado.';
  return 'Não foi possível salvar. Verifique a internet e tente de novo.';
};
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); toast(errMsg(e), 5000); } };

/* ---------- formulário (criar/editar) ---------- */
function openForm(pre = {}) {
  const editing = !!pre.id;
  const P = S.perms;
  if (!editing && !P.pessoal && !P.empresa) { toast('O administrador do grupo ainda não liberou criar tarefas para você.', 5000); return; }
  let cat0 = pre.cat || 'pessoal';
  if (!editing && !P[cat0]) cat0 = cat0 === 'pessoal' ? 'empresa' : 'pessoal';
  const f = {
    kind: pre.kind || 'tarefa', cat: cat0, alerts: [...alertsOf(pre)],
    invites: editing ? pre.members.filter((m) => m.role !== 'dono').map((m) => ({ id: m.id, email: m.email || '', name: personName(m) })) : (pre.guests || []).map((n) => ({ name: n, email: '' })),
  };
  const date = pre.due ? pre.due.slice(0, 10) : pre.noDate ? '' : S.sel;
  const el = sheet(editing ? 'Editar' : 'Novo registro', `
    ${pre.heard ? `<div class="heard"><b>Você disse:</b> “${esc(pre.heard)}”</div>` : ''}
    <div class="opts" id="fKind">${[['tarefa', 'Tarefa'], ['lembrete', 'Lembrete'], ['reuniao', 'Reunião']].map(([k, l]) => `<button type="button" class="opt y" data-k="${k}" aria-pressed="${f.kind === k}" ${editing && pre.kind === 'reuniao' && k !== 'reuniao' && pre.members.length > 1 ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <label class="f">O quê?<input class="inp" id="fTitle" required maxlength="140" placeholder="Ex.: Pagar a conta de luz" value="${esc(pre.title || '')}"></label>
    <div class="opts" id="fCat"><button type="button" class="opt p" data-c="pessoal" aria-pressed="${f.cat === 'pessoal'}" ${!P.pessoal && f.cat !== 'pessoal' ? 'disabled title="Sem acesso"' : ''}>Pessoal</button><button type="button" class="opt e" data-c="empresa" aria-pressed="${f.cat === 'empresa'}" ${!P.empresa && f.cat !== 'empresa' ? 'disabled title="Sem acesso"' : ''}>Empresa</button></div>
    <div class="row2"><label class="f">Dia<input class="inp" type="date" id="fDate" value="${date}"></label><label class="f">Horário<input class="inp" type="time" id="fTime" value="${timeOf(pre.due || '')}"></label></div>
    <label class="f">Repetir<select class="inp" id="fRec">${RECURRENCE.map(([v, l]) => `<option value="${v}" ${(pre.recurrence || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="f"><span>Alertas</span><div class="chips" id="fAlerts">${alertChips(f.alerts)}</div></div>
    <div id="fMeet" class="detail-sec" ${f.kind === 'reuniao' ? '' : 'hidden'}>
      ${P.convite ? '' : '<p class="note" style="margin:0;color:var(--red)">O administrador do grupo não liberou o envio de convites para você.</p>'}
      <label class="f" ${P.convite ? '' : 'hidden'}>Convidar por e-mail<div style="display:flex;gap:8px"><input class="inp" id="fWho" type="email" inputmode="email" placeholder="nome@empresa.com"><button type="button" class="ghost" id="fAdd">Adicionar</button></div></label>
      <div class="people" id="fChips"></div>
      <p class="note" style="margin:0" ${P.convite ? '' : 'hidden'}>Quem tem conta no RN Group recebe o convite e os alertas na hora. Quem ainda não tem recebe quando criar a conta com esse e-mail, e você também pode mandar pelo WhatsApp.</p>
      <label class="f">Local ou link<input class="inp" id="fPlace" maxlength="200" placeholder="Sala, endereço ou link do Meet" value="${esc(pre.place || '')}"></label>
      <label class="f">Pauta<textarea class="inp" id="fAgenda" maxlength="2000" placeholder="Assuntos da reunião, um por linha">${esc(pre.agenda || '')}</textarea></label>
    </div>
    <label class="f">Observação<textarea class="inp" id="fNotes" maxlength="1000" placeholder="Opcional">${esc(pre.notes || '')}</textarea></label>
    <button class="btn" type="submit" id="fSave" style="--c:${f.cat === 'empresa' ? 'var(--blue)' : 'var(--green)'};padding:14px">${editing ? 'Salvar alterações' : 'Salvar'}</button>`, { form: true });
  const paint = () => {
    $('#fChips').innerHTML = f.invites.map((g, i) => `<span class="person"><span class="av">${esc((g.name || g.email || '?')[0])}</span>${esc(g.name || g.email)}${!g.email ? ' <span class="note">(sem e-mail)</span>' : ''}<button type="button" class="chipx" data-rm="${i}" aria-label="Remover">✕</button></span>`).join('');
  };
  paint();
  const setCat = (c) => { f.cat = c; $$('#fCat .opt').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === c)); $('#fSave').style.setProperty('--c', c === 'empresa' ? 'var(--blue)' : 'var(--green)'); };
  $('#fKind').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; f.kind = k; $$('#fKind .opt').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === k)); $('#fMeet').hidden = k !== 'reuniao'; if (k === 'reuniao' && !pre.cat && P.empresa) setCat('empresa'); };
  $('#fCat').onclick = (e) => { const c = e.target.dataset.c; if (c && !e.target.disabled) setCat(c); };
  $('#fAlerts').onclick = (e) => { const b = e.target.closest('[data-al]'); if (!b) return; const v = +b.dataset.al; f.alerts = f.alerts.includes(v) ? f.alerts.filter((x) => x !== v) : [...f.alerts, v].sort((a, c) => c - a); b.setAttribute('aria-pressed', f.alerts.includes(v)); };
  const addWho = () => {
    const v = $('#fWho').value.trim(); if (!v) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Digite um e-mail válido'); return; }
    if (f.invites.some((g) => g.email === v.toLowerCase())) { $('#fWho').value = ''; return; }
    // se já havia um convidado só com nome (veio da voz), completa o e-mail dele
    const nameOnly = f.invites.find((g) => !g.email && !g.id);
    if (nameOnly) nameOnly.email = v.toLowerCase(); else f.invites.push({ email: v.toLowerCase(), name: '' });
    $('#fWho').value = ''; paint();
  };
  $('#fAdd').onclick = addWho;
  $('#fWho').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWho(); } });
  $('#fChips').onclick = (e) => { const i = e.target.dataset.rm; if (i != null) { f.invites.splice(+i, 1); paint(); } };
  el.onsubmit = safe(async (e) => {
    e.preventDefault();
    if ($('#fWho').value.trim()) addWho();
    if (!P.convite) f.invites = f.invites.filter((g) => g.id);
    const title = $('#fTitle').value.trim(); if (!title) return;
    const d = $('#fDate').value, tm = $('#fTime').value;
    if (f.kind === 'reuniao' && (!d || !tm)) { toast('Para marcar reunião, escolha dia e horário'); return; }
    const rec = $('#fRec').value || null;
    if (rec && !d) { toast('Para repetir, escolha o dia da primeira vez'); return; }
    const { due_at, all_day } = fromLocal(d, tm);
    const row = {
      kind: f.kind, cat: f.cat, title, notes: $('#fNotes').value.trim(), due_at, all_day, recurrence: rec,
      alerts: JSON.stringify(f.alerts) === JSON.stringify(defAlerts()) ? null : f.alerts,
      place: f.kind === 'reuniao' ? $('#fPlace').value.trim() : '', agenda: f.kind === 'reuniao' ? $('#fAgenda').value.trim() : '',
    };
    $('#fSave').disabled = true;
    if (!editing) {
      const invites = f.kind === 'reuniao' ? f.invites : [];
      const id = await api.createItem(row, invites);
      closeSheet();
      if (invites.some((g) => g.email)) api.notify(id, 'convite');
      if (invites.length) shareSheet({ ...row, due: toLocal(due_at, all_day) }, invites);
      else toast(f.kind === 'reuniao' ? 'Reunião marcada' : f.kind === 'lembrete' ? 'Lembrete criado' : 'Tarefa criada');
    } else {
      await api.updateItem(pre.id, row);
      const moved = pre.due_at !== due_at && pre.kind === 'reuniao' && pre.members.length > 1;
      if (moved) { await api.addReschedule(pre.id, pre.due_at, due_at, 'Horário alterado pelo organizador'); await api.resetRsvp(pre.id); api.notify(pre.id, 'reagendada'); }
      if (f.kind === 'reuniao') {
        const keep = new Set(f.invites.filter((g) => g.id).map((g) => g.id));
        for (const m of pre.members) if (m.role !== 'dono' && !keep.has(m.id)) await api.removeMember(m.id);
        const added = f.invites.filter((g) => !g.id);
        if (added.length) { await api.addMembers(pre.id, added); api.notify(pre.id, 'convite'); }
      }
      closeSheet(); toast('Alterações salvas');
    }
    if (d) S.sel = d;
    await reload();
  });
  if (!pre.title) setTimeout(() => $('#fTitle')?.focus(), 60);
}

/* ---------- convite para fora do app ---------- */
function inviteText(it) {
  return `Convite: ${it.title}\nQuando: ${whenLabel(it.due).replace('Hoje', 'hoje').replace('Amanhã', 'amanhã')}${it.place ? `\nOnde: ${it.place}` : ''}${it.agenda ? `\nPauta: ${it.agenda.split('\n').join('; ')}` : ''}\n\nConfirme pelo app RN Group: ${location.origin}`;
}
function shareSheet(it, invites) {
  const txt = inviteText(it);
  const semConta = invites.filter((g) => !g.email).map((g) => g.name);
  sheet('Reunião marcada', `
    <p style="margin:0">${semConta.length ? `${esc(semConta.join(', '))} ainda não ${semConta.length === 1 ? 'tem' : 'têm'} e-mail no convite. ` : ''}Mande o convite também pelo WhatsApp:</p>
    <div class="share" id="shTxt">${esc(txt)}</div>
    <div class="actions"><a class="btn" style="--c:#1FA855;text-decoration:none" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar no WhatsApp</a><button class="ghost" id="shCopy">Copiar</button></div>`);
  $('#shCopy').onclick = () => copy(txt, $('#shTxt'));
}
function copy(txt, el) {
  const sel = () => { if (!el) return; const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Texto selecionado. Toque em Copiar.'); };
  try { navigator.clipboard.writeText(txt).then(() => toast('Convite copiado'), sel); } catch { sel(); }
}

/* ---------- detalhes do item ---------- */
function openDetail(id) {
  const it = S.items.find((x) => x.id === id); if (!it) return;
  const meeting = it.kind === 'reuniao';
  sheet(esc(it.title), `
    <div class="meta" style="font-size:14px"><span class="${it.cat === 'empresa' ? 'k-e' : 'k-p'}">${it.cat === 'empresa' ? 'Empresa' : 'Pessoal'}</span><span>·</span><span>${esc(whenLabel(it.due))}</span>${it.recurrence ? `<span class="rec-tag">${ICON.repeat}${esc(recurrenceLabel(it.recurrence))}</span>` : ''}</div>
    ${it.place ? `<div class="where" style="font-size:14px">Local: ${/^https?:\/\//.test(it.place) ? `<a href="${esc(it.place)}" target="_blank" rel="noopener">${esc(it.place)}</a>` : esc(it.place)}</div>` : ''}
    ${it.due && it.due.length > 10 ? `<div class="note">Alertas: ${alertsOf(it).map((a) => (ALERTAS.find((x) => x[0] === a) || [0, a + ' min antes'])[1]).join(', ') || 'nenhum'}</div>` : ''}
    ${it.notices.length ? `<div class="detail-sec">${it.notices.slice(0, 3).map((n) => `<div class="notice">${esc(nameOf(n.by))} vai se atrasar${n.minutes ? ` ${n.minutes} min` : ''}${n.message ? ': ' + esc(n.message) : ''}</div>`).join('')}</div>` : ''}
    ${requestsHTML(it)}
    ${meeting ? `<div class="detail-sec"><h3>Participantes</h3>${peopleHTML(it)}</div>` : ''}
    ${meeting && !it.isOwner ? `<div class="inv-actions"><button class="btn" style="--c:var(--green)" data-rsvp="sim">Vou participar</button><button class="btn no" data-rsvp="nao">Não posso</button></div>` : ''}
    ${meeting && it.agenda ? `<div class="detail-sec"><h3>Pauta</h3><div style="white-space:pre-line">${esc(it.agenda)}</div></div>` : ''}
    ${meeting ? `<div class="detail-sec"><h3>Ata da reunião</h3>${it.isOwner ? `<textarea class="inp" id="dMin" maxlength="5000" placeholder="O que foi decidido, responsáveis e prazos">${esc(it.minutes || '')}</textarea><button class="ghost" id="dMinSave">Salvar ata</button>` : `<div style="white-space:pre-line">${esc(it.minutes || 'Ainda não preenchida.')}</div>`}</div>` : ''}
    ${it.notes ? `<div class="detail-sec"><h3>Observação</h3><div style="white-space:pre-line">${esc(it.notes)}</div></div>` : ''}
    ${it.history.length ? `<div class="detail-sec"><h3>Histórico de mudanças</h3><div class="hist">${histHTML(it)}</div></div>` : ''}
    <div class="actions">
      ${it.isOwner ? '<button class="ghost" data-d="edit">Editar</button><button class="ghost" data-d="resch">Reagendar</button>' : meeting ? '<button class="ghost" data-d="ask">Pedir novo horário</button>' : ''}
      ${meeting ? '<button class="ghost" data-d="late">Estou atrasado</button>' : ''}
      ${it.due && it.due.length > 10 && !it.done ? '<button class="ghost" data-d="snooze">Lembrar em 10 min</button>' : ''}
      ${meeting && it.isOwner && it.members.length > 1 && S.perms.convite ? '<button class="ghost" data-d="share">Enviar convite</button>' : ''}
      ${it.isOwner ? `<button class="ghost" data-d="del" style="color:var(--red)">${meeting && it.members.length > 1 ? 'Cancelar reunião' : 'Excluir'}</button>` : ''}
    </div>`);
  const el = $('#sheet'); el.dataset.mid = it.id;
  $('#dMinSave') && ($('#dMinSave').onclick = safe(async () => { await api.updateItem(it.id, { minutes: $('#dMin').value.trim() }); toast('Ata salva'); await reload(); }));
  el.addEventListener('click', safe(async (e) => {
    const a = e.target.closest('[data-d]')?.dataset.d; if (!a) return;
    if (a === 'edit') openForm(it);
    if (a === 'resch') reschedSheet(it, false);
    if (a === 'ask') reschedSheet(it, true);
    if (a === 'late') lateSheet(it);
    if (a === 'share') shareSheet(it, it.members.filter((m) => m.role !== 'dono').map((m) => ({ email: m.email, name: personName(m) })));
    if (a === 'snooze') await snooze(it);
    if (a === 'del') confirmDelete(it);
  }));
}
function confirmDelete(it) {
  const meeting = it.kind === 'reuniao' && it.members.length > 1;
  sheet(meeting ? 'Cancelar reunião?' : 'Excluir?', `
    <p style="margin:0">${meeting ? 'Todos os participantes serão avisados de que a reunião foi cancelada.' : `“${esc(it.title)}” será apagado.`}</p>
    <div class="inv-actions"><button class="btn" id="cYes" style="--c:var(--red)">${meeting ? 'Cancelar reunião' : 'Excluir'}</button><button class="btn no" id="cNo">Voltar</button></div>`);
  $('#cNo').onclick = closeSheet;
  $('#cYes').onclick = safe(async () => {
    if (meeting) await api.notify(it.id, 'cancelada');
    await api.deleteItem(it.id); closeSheet(); toast(meeting ? 'Reunião cancelada' : 'Excluído'); await reload();
  });
}
async function snooze(it) {
  if (!it.my) return;
  await api.updateMember(it.my.id, { snooze_until: new Date(Date.now() + 10 * 60000).toISOString() });
  closeSheet(); toast('Vou te lembrar de novo em 10 minutos'); await reload();
}

/* ---------- reagendar ---------- */
const MOTIVOS = ['Conflito de agenda', 'Pedido do cliente', 'Participante indisponível', 'Imprevisto', 'Atraso no trânsito'];
function reschedSheet(it, asking) {
  const cur = it.due || ymd(new Date());
  const el = sheet(asking ? 'Pedir novo horário' : 'Reagendar', `
    <div><div class="t">${esc(it.title)}</div><div class="meta">Horário atual: ${esc(whenLabel(it.due))}</div></div>
    <div class="row2"><label class="f">Novo dia<input class="inp" type="date" id="rDate" required value="${cur.slice(0, 10)}"></label><label class="f">Novo horário<input class="inp" type="time" id="rTime" value="${timeOf(cur)}"></label></div>
    <div class="f"><span>Motivo</span><div class="chips" id="rChips">${MOTIVOS.map((m) => `<button type="button" class="opt y" data-m="${m}" aria-pressed="false">${m}</button>`).join('')}</div></div>
    <label class="f">Explique o motivo<textarea class="inp" id="rReason" required maxlength="300" placeholder="Ex.: o cliente pediu para passar para depois do almoço"></textarea></label>
    <p class="note" style="margin:0">${asking ? 'O organizador recebe seu pedido e decide se muda o horário.' : it.kind === 'reuniao' && it.members.length > 1 ? 'Todos os participantes recebem o novo horário e o motivo, e confirmam a presença de novo.' : 'O motivo fica guardado no histórico.'}</p>
    <button class="btn" type="submit" style="padding:14px">${asking ? 'Enviar pedido' : 'Salvar novo horário'}</button>
    ${it.history.length ? `<div class="detail-sec"><h3>Histórico de mudanças</h3><div class="hist">${histHTML(it)}</div></div>` : ''}`, { form: true });
  $('#rChips').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; $$('#rChips .opt').forEach((x) => x.setAttribute('aria-pressed', x === b)); const r = $('#rReason'); if (!r.value.trim() || MOTIVOS.includes(r.value.trim())) r.value = b.dataset.m; };
  el.onsubmit = safe(async (e) => {
    e.preventDefault();
    const d = $('#rDate').value, tm = $('#rTime').value, reason = $('#rReason').value.trim();
    if (!d || !reason) { toast('Escolha o dia e escreva o motivo'); return; }
    if (it.kind === 'reuniao' && !tm) { toast('Reunião precisa de horário'); return; }
    const { due_at, all_day } = fromLocal(d, tm);
    if (due_at === it.due_at) { toast('O novo horário é igual ao atual'); return; }
    if (asking) {
      await api.requestReschedule(it.id, due_at, reason);
      api.notify(it.id, 'pedido', { reason });
      closeSheet(); toast('Pedido enviado ao organizador'); await reload(); return;
    }
    await api.updateItem(it.id, { due_at, all_day });
    await api.addReschedule(it.id, it.due_at, due_at, reason);
    if (it.my) await api.updateMember(it.my.id, { snooze_until: null });
    const shared = it.kind === 'reuniao' && it.members.length > 1;
    if (shared) { await api.resetRsvp(it.id); api.notify(it.id, 'reagendada', { reason }); }
    closeSheet(); S.sel = d; toast(shared ? 'Reunião reagendada. Os participantes foram avisados.' : 'Reagendado'); await reload();
  });
}
async function resolveReq(it, reqId, accept) {
  const r = it.requests.find((x) => x.id === reqId); if (!r) return;
  await api.resolveRequest(r.id, accept ? 'aceito' : 'recusado');
  if (accept) {
    await api.updateItem(it.id, { due_at: r.to_at, all_day: false });
    await api.addReschedule(it.id, it.due_at, r.to_at, `${r.reason} (pedido de ${nameOf(r.by)})`);
    await api.resetRsvp(it.id);
    const m = it.members.find((x) => x.user_id === r.by); if (m) await api.updateMember(m.id, { rsvp: 'sim' });
    api.notify(it.id, 'reagendada', { reason: r.reason });
    api.notify(it.id, 'pedido_resposta', { to_user: r.by, reason: 'seu pedido foi aceito e o horário mudou' });
    toast('Reunião reagendada');
  } else {
    api.notify(it.id, 'pedido_resposta', { to_user: r.by, reason: 'o organizador manteve o horário' });
    toast('Horário mantido');
  }
  await reload();
}

/* ---------- estou atrasado ---------- */
function lateSheet(it) {
  let min = 10;
  const el = sheet('Estou atrasado', `
    <p style="margin:0">Os outros participantes de “${esc(it.title)}” vão receber o aviso na hora.</p>
    <div class="chips" id="lMin">${[5, 10, 15, 30, 60].map((m) => `<button type="button" class="opt y" data-min="${m}" aria-pressed="${m === min}">${m < 60 ? m + ' min' : '1 hora'}</button>`).join('')}</div>
    <label class="f">Mensagem (opcional)<input class="inp" id="lMsg" maxlength="140" placeholder="Ex.: trânsito na marginal"></label>
    <button class="btn" type="submit" style="--c:var(--red);padding:14px">Avisar participantes</button>`, { form: true });
  $('#lMin').onclick = (e) => { const b = e.target.closest('[data-min]'); if (!b) return; min = +b.dataset.min; $$('#lMin .opt').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
  el.onsubmit = safe(async (e) => {
    e.preventDefault();
    const msg = $('#lMsg').value.trim();
    await api.addNotice(it.id, min, msg);
    api.notify(it.id, 'atraso', { minutes: min, reason: msg });
    closeSheet(); toast('Participantes avisados'); await reload();
  });
}

/* ---------- voz: criar por fala ---------- */
let rec = null;
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return voiceSheet();
  try {
    rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.maxAlternatives = 1;
    const btn = $('#voiceBtn'); btn.classList.add('rec'); $('#voiceTxt').textContent = 'Ouvindo… fale sua tarefa';
    let final = '', failed = false, heard = false;
    const guard = setTimeout(() => { if (!heard) { failed = true; try { rec?.abort(); } catch { /* ignora */ } rec?.onend?.(); } }, 7000);
    rec.onresult = (e) => { heard = true; let s = ''; for (const r of e.results) s += r[0].transcript; final = s; $('#voiceTxt').textContent = s; };
    rec.onerror = () => { failed = true; };
    rec.onend = () => {
      clearTimeout(guard); if (!rec) return; rec = null;
      btn.classList.remove('rec'); $('#voiceTxt').textContent = 'Toque para falar uma tarefa';
      if (final.trim()) openForm(parseFala(final)); else if (failed) voiceSheet();
    };
    rec.start();
  } catch { voiceSheet(); }
}
function voiceSheet() {
  const el = sheet('Falar uma tarefa', `
    <p style="margin:0">Toque no campo e use o <b>microfone do teclado</b> para ditar. O app entende dia, horário, repetição, categoria e convidados.</p>
    <textarea class="inp" id="vText" placeholder="Ex.: Reunião com João e Ana amanhã às 15h sobre o orçamento"></textarea>
    <div class="opts" id="vEx"><button type="button" class="opt">Me lembra de pagar a luz sexta às 9h</button><button type="button" class="opt">Reunião de equipe toda segunda às 9h</button><button type="button" class="opt">Ligar para o cliente hoje 16:30</button></div>
    <button class="btn" type="submit" style="padding:14px">Continuar</button>`, { form: true });
  $('#vEx').onclick = (e) => { if (e.target.classList.contains('opt')) $('#vText').value = e.target.textContent; };
  el.onsubmit = (e) => { e.preventDefault(); const v = $('#vText').value.trim(); if (v) openForm(parseFala(v)); };
  setTimeout(() => $('#vText')?.focus(), 60);
}

/* ---------- resumo do dia (texto + áudio) ---------- */
const NUM = ['nenhum', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];
const n2 = (n, um, varios, fem) => (n === 0 ? `nenhum${fem ? 'a' : ''} ${um}` : n === 1 ? `${fem ? 'uma' : 'um'} ${um}` : n === 2 && fem ? `duas ${varios}` : `${NUM[n] || n} ${varios}`);
const hora = (t) => { const [h, m] = t.split(':').map(Number); return m ? `${h} e ${m}` : h === 1 ? '1 hora' : `${h} horas`; };
export function buildBrief(dayKey) {
  const k = dayKey || ymd(new Date()); const d = new Date(k + 'T12:00');
  const its = visible().filter((x) => !x.done);
  const doDia = its.filter((x) => x.due && x.due.startsWith(k)).sort(byDue);
  const late = its.filter((x) => status(x) === 'late' && !x.due.startsWith(k));
  const reun = doDia.filter((x) => x.kind === 'reuniao');
  const nome = (S.profile?.name || '').split(' ')[0];
  const h = new Date().getHours(); const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const L = [`${saud}${nome ? ', ' + nome : ''}. ${k === ymd(new Date()) ? 'Hoje, ' : ''}${DIAS_L[d.getDay()]}, ${d.getDate()} de ${MESES_L[d.getMonth()]}.`];
  if (!doDia.length) L.push('Você não tem nada marcado para este dia.');
  else {
    L.push(`Você tem ${n2(reun.length, 'reunião', 'reuniões', true)} e ${n2(doDia.length - reun.length, 'tarefa', 'tarefas', true)}.`);
    for (const x of doDia) {
      const tm = timeOf(x.due); const last = x.history[x.history.length - 1];
      let l = `${tm ? 'Às ' + hora(tm) : 'Durante o dia'}: ${x.title}, ${x.cat === 'empresa' ? 'empresa' : 'pessoal'}`;
      if (x.kind === 'reuniao') { const n = x.members.length - 1; if (n) l += `, com ${n} ${n === 1 ? 'participante' : 'participantes'}`; if (x.place && !/^https?:/.test(x.place)) l += `, em ${x.place}`; }
      if (last) l += `. Atenção: mudou de horário. Motivo: ${last.reason}`;
      L.push(l + '.');
    }
  }
  if (late.length) L.push(`Você tem ${n2(late.length, 'pendência atrasada', 'pendências atrasadas', true)}: ${late.slice(0, 3).map((x) => x.title).join(', ')}.`);
  const conv = S.items.filter((m) => m.kind === 'reuniao' && !m.isOwner && m.rsvp === 'pendente').length;
  if (conv) L.push(`${n2(conv, 'convite', 'convites')} ${conv === 1 ? 'aguarda' : 'aguardam'} sua resposta.`);
  const ped = S.items.filter((m) => m.isOwner).reduce((n, m) => n + m.requests.filter((r) => r.status === 'aberto').length, 0);
  if (ped) L.push(`${n2(ped, 'pedido', 'pedidos')} de mudança de horário para você decidir.`);
  L.push('Bom trabalho!');
  return L.join('\n');
}
function renderBrief() {
  $('#briefTxt').textContent = buildBrief(S.sel);
  const n = visible().filter((x) => !x.done && x.due && x.due.startsWith(S.sel)).length;
  if (!$('#brief').classList.contains('playing')) $('#briefSub').textContent = n ? `${n} ${n === 1 ? 'item' : 'itens'} ${S.sel === ymd(new Date()) ? 'hoje' : 'neste dia'} · toque para ouvir` : 'Dia livre · toque para ouvir';
}
function speak(text, onState) {
  const ss = window.speechSynthesis;
  if (!ss) { toast('Este aparelho não lê em voz alta. O resumo está escrito.'); return false; }
  if (ss.speaking) { ss.cancel(); onState?.(false); return false; }
  const u = new SpeechSynthesisUtterance(text.replace(/\n/g, ' '));
  u.lang = 'pt-BR';
  const v = ss.getVoices().find((x) => /pt[-_]BR/i.test(x.lang)) || ss.getVoices().find((x) => /^pt/i.test(x.lang)); if (v) u.voice = v;
  u.onstart = () => onState?.(true);
  u.onend = u.onerror = () => onState?.(false);
  ss.cancel(); ss.speak(u);
  return true;
}
function playBriefCard() {
  speak(buildBrief(S.sel), (on) => { $('#brief').classList.toggle('playing', on); if (on) $('#briefSub').textContent = 'Tocando… toque para parar'; else renderBrief(); });
}
function briefSheet() {
  const txt = buildBrief();
  sheet('Resumo do dia', `<button class="big-play" id="bp" aria-label="Ouvir resumo">${ICON.play}</button><p class="note" style="text-align:center;margin:0">Toque para ouvir</p><div class="brief-txt" style="white-space:pre-line;font-size:15px;color:var(--fg)">${esc(txt)}</div>`);
  $('#bp').onclick = () => speak(txt, (on) => { $('#bp').classList.toggle('on', on); $('#bp').innerHTML = on ? ICON.stop : ICON.play; });
}

/* ---------- lembretes com o app aberto (quando o push não está ativo) ---------- */
let audioOK = false; document.addEventListener('pointerdown', () => { audioOK = true; }, { once: true });
function beep() {
  if (!audioOK) return;
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22].forEach((t0) => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = 880; o.connect(g); g.connect(A.destination); g.gain.setValueAtTime(0.0001, A.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.25, A.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + t0 + 0.18); o.start(A.currentTime + t0); o.stop(A.currentTime + t0 + 0.2); });
  } catch { /* sem som */ }
}
const fired = new Set(ls.get('rng.fired', []));
function checkReminders() {
  if (!S.user) return;
  if (S.push !== 'ativo') {
    const now = Date.now();
    for (const it of visible()) {
      if (!it.due || it.done || it.due.length === 10) continue;
      const at = new Date(it.due).getTime();
      const offs = [...alertsOf(it)].sort((a, b) => a - b);
      const sn = it.my?.snooze_until ? new Date(it.my.snooze_until).getTime() : null;
      const cands = offs.map((o) => [`${it.id}@${it.due_at}@${o}`, at - o * 60000]);
      if (sn) cands.push([`${it.id}@s${sn}`, sn]);
      for (const [key, t0] of cands) {
        if (now >= t0 && now < t0 + 10 * 60000 && !fired.has(key)) {
          fired.add(key); ls.set('rng.fired', [...fired].slice(-300));
          const mins = Math.round((at - now) / 60000);
          const quando = mins <= 0 ? 'agora' : mins < 60 ? `em ${mins} min` : `em ${Math.round(mins / 6) / 10} h`.replace('.', ',');
          toast(`${it.kind === 'reuniao' ? 'Reunião' : it.kind === 'lembrete' ? 'Lembrete' : 'Tarefa'}: ${it.title} ${quando}`, 15000, { label: 'Lembrar em 10 min', run: () => snooze(it) });
          beep(); break;
        }
      }
    }
  }
  renderDay(); renderAgenda();
}

/* ---------- eventos ---------- */
document.addEventListener('click', safe(async (e) => {
  const t = e.target;
  if (t.closest('#groupsCard') && await groupClick(t)) return;
  const day = t.closest('[data-day]'); if (day) { S.sel = day.dataset.day; render(); return; }
  const nw = t.closest('[data-new]'); if (nw) { const k = nw.dataset.new; openForm(k === 'reuniao' ? { kind: 'reuniao', cat: 'empresa' } : { cat: k }); return; }
  const fl = t.closest('[data-filter]'); if (fl) { S.filter = fl.dataset.filter; $$('#seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === S.filter)); render(); $('#seg').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const sg = t.closest('#seg [data-f]'); if (sg) { S.filter = sg.dataset.f; $$('#seg button').forEach((b) => b.setAttribute('aria-pressed', b === sg)); render(); return; }
  const sg2 = t.closest('#seg2 [data-f]'); if (sg2) { S.filter2 = sg2.dataset.f; $$('#seg2 button').forEach((b) => b.setAttribute('aria-pressed', b === sg2)); render(); return; }
  const g = t.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
  if (t.closest('#voiceBtn')) { if (rec) { rec.stop(); return; } startVoice(); return; }
  if (t.closest('#playBrief')) { playBriefCard(); return; }
  if (t.closest('#toggleBrief')) { const tx = $('#briefTxt'); tx.hidden = !tx.hidden; t.closest('#toggleBrief').textContent = tx.hidden ? 'Ler' : 'Fechar'; return; }
  if (t.closest('#installBtn')) { S.installEvt?.prompt(); S.installEvt = null; renderBanners(); return; }
  if (t.closest('[data-push]') || t.closest('#pushBtn')) {
    if (S.push === 'ativo') { await disablePush(); toast('Notificações desligadas neste aparelho'); }
    else if (await enablePush()) toast('Notificações ativadas'); else toast('Permissão negada. Libere as notificações nas configurações do navegador.');
    S.push = await pushStatus(); render(); return;
  }
  if (t.closest('#tgBtn')) {
    if (S.profile?.telegram_on) { await api.updateProfile({ telegram_on: false }); S.profile.telegram_on = false; toast('Telegram desligado'); render(); }
    else { window.open(`https://t.me/${BOT}?start=${S.profile.telegram_link_code}`, '_blank'); toast('No Telegram, toque em Começar. Depois volte aqui.', 6000); }
    return;
  }
  if (t.closest('#testRem')) { audioOK = true; toast('Teste: assim chega o alerta das suas tarefas', 6000); beep(); return; }
  if (t.closest('#logout') || t.closest('#logoutTop')) { confirmLogout(); return; }

  // aceitar / manter pedido de novo horário (no card ou nos detalhes)
  const acc = t.closest('[data-acc]'), ign = t.closest('[data-ign]');
  if (acc || ign) {
    const host = t.closest('[data-mid]'); const it = S.items.find((x) => x.id === host?.dataset.mid); if (!it) return;
    await resolveReq(it, (acc || ign).dataset.acc || (acc || ign).dataset.ign, !!acc);
    if ($('#sheet')) openDetail(it.id);
    return;
  }
  const rv = t.closest('[data-rsvp]');
  if (rv) {
    const host = t.closest('[data-mid]'); const it = S.items.find((x) => x.id === host?.dataset.mid); if (!it?.my) return;
    await api.updateMember(it.my.id, { rsvp: rv.dataset.rsvp });
    api.notify(it.id, 'rsvp');
    toast(rv.dataset.rsvp === 'sim' ? 'Presença confirmada' : 'Convite recusado'); closeSheet(); await reload(); return;
  }
  const row = t.closest('.item');
  if (row) {
    const it = S.items.find((x) => x.id === row.dataset.id); if (!it) return;
    if (t.closest('.chk')) {
      if (!it.my) return;
      if (!it.done && it.recurrence && it.due_at && it.isOwner) {
        const next = nextOccurrence(it.due_at, it.recurrence);
        await api.updateItem(it.id, { due_at: next });
        await api.updateMember(it.my.id, { snooze_until: null });
        toast(`Feito! Próxima: ${whenLabel(toLocal(next, it.all_day))}`);
      } else {
        await api.updateMember(it.my.id, { done: !it.done, snooze_until: null });
        if (!it.done) toast('Concluída');
      }
      await reload(); return;
    }
    openDetail(it.id); return;
  }
  const ic = t.closest('.inv-card');
  if (ic) {
    const m = S.items.find((x) => x.id === ic.dataset.mid); if (!m) return;
    if (t.closest('[data-share]')) { shareSheet(m, m.members.filter((x) => x.role !== 'dono').map((x) => ({ email: x.email, name: personName(x) }))); return; }
    if (t.closest('[data-open]') || !t.closest('button')) { openDetail(m.id); }
  }
}));
document.addEventListener('change', safe(async (e) => {
  const t = e.target;
  if (t.id === 'pNameIn') { const name = t.value.trim(); await api.updateProfile({ name }); S.profile.name = name; toast('Nome salvo'); render(); }
  if (t.id === 'briefOn') { await api.updateProfile({ brief_on: t.checked }); S.profile.brief_on = t.checked; toast(t.checked ? 'Resumo do dia ativado' : 'Resumo do dia desativado'); }
  if (t.id === 'briefTime' && t.value) { await api.updateProfile({ brief_time: t.value }); S.profile.brief_time = t.value; toast('Resumo programado para ' + t.value); }
}));
document.addEventListener('click', safe(async (e) => {
  const b = e.target.closest('#defAlerts [data-al]'); if (!b) return;
  const v = +b.dataset.al; let al = defAlerts();
  al = al.includes(v) ? al.filter((x) => x !== v) : [...al, v].sort((a, c) => c - a);
  await api.updateProfile({ default_alerts: al }); S.profile.default_alerts = al; render();
}));

/* tema */
$('#themeSel').addEventListener('change', (e) => { applyTheme(e.target.value); ls.set('rng.theme', e.target.value); });
function applyTheme(v) { if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); $('#themeSel').value = v; }

/* abrir pela notificação: /?item=..., /?resumo=1 */
let urlHandled = false;
function openFromUrl() {
  if (urlHandled) return; urlHandled = true;
  const q = new URLSearchParams(location.search);
  if (q.get('resumo')) briefSheet();
  else if (q.get('item')) { const it = S.items.find((x) => x.id === q.get('item')); if (it) { if (q.get('acao') === 'adiar') snooze(it); else openDetail(it.id); } }
  else if (q.get('senha')) newPasswordSheet();
  if ([...q.keys()].length) history.replaceState(null, '', '/');
}
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open') { urlHandled = false; history.replaceState(null, '', e.data.url); openFromUrl(); } });

/* ---------- conta ---------- */
function renderAuth(msg = '', ok = false) {
  $('#app').hidden = true; $('.nav').hidden = true; $('#auth').hidden = false;
  $('#auth').innerHTML = `
    <div><div class="brand"><b>RN</b> Group</div><div class="sub">Tarefas, lembretes e reuniões. Pessoal e Empresa.</div></div>
    <form id="authForm">
      <h2 style="margin:0">Entrar</h2>
      <label class="f">Usuário<input class="inp" id="aUser" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Seu usuário"></label>
      <label class="f">Senha<input class="inp" id="aPass" type="password" required minlength="6" autocomplete="current-password"></label>
      ${msg ? `<p class="${ok ? 'note' : 'err'}" role="alert">${esc(msg)}</p>` : ''}
      <button class="btn" type="submit" style="padding:14px">Entrar</button>
      <button type="button" class="link" id="aForgot">Esqueci minha senha</button>
    </form>
    <p class="note">Ainda não tem acesso? Peça ao administrador do seu grupo o seu usuário e a senha temporária.</p>
    ${api.mode === 'demo' ? '<p class="note">Modo demonstração: digite qualquer usuário e senha. Os dados ficam só neste aparelho.</p>' : ''}`;
  $('#aForgot').onclick = async () => {
    renderAuth('Peça ao administrador do seu grupo uma nova senha temporária. No próximo acesso você cria a sua.', true);
  };
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#authForm button[type=submit]'); btn.disabled = true;
    try { await api.signIn($('#aUser').value, $('#aPass').value); await startApp(); } catch (err) { renderAuth(traduz(err)); }
  };
  setTimeout(() => $('#aUser')?.focus(), 60);
}

/* contas antigas (criadas com e-mail): escolher o usuário uma única vez */
function renderPickUser(msg = '') {
  $('#app').hidden = true; $('.nav').hidden = true; $('#auth').hidden = false;
  $('#auth').innerHTML = `
    <div><div class="brand"><b>RN</b> Group</div><div class="sub">O login agora é por usuário.</div></div>
    <form id="pickForm">
      <h2 style="margin:0">Escolha seu usuário</h2>
      <p class="note" style="margin:0">A partir de agora você entra com este usuário e a sua senha. Ele não pode ser mudado depois. Seu e-mail continua no cadastro, só para receber informações.</p>
      <label class="f">Usuário<input class="inp" id="pkUser" required maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Ex.: ola.adm"></label>
      <span class="note" style="margin-top:-6px">De 3 a 30 letras minúsculas, números, ponto, hífen ou _ (sem acento e sem espaço).</span>
      <p class="err" role="alert" id="pkErr" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <button class="btn" type="submit" style="padding:14px">Salvar usuário</button>
    </form>`;
  $('#pkUser').oninput = (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s/g, ''); };
  $('#pickForm').onsubmit = async (e) => {
    e.preventDefault();
    const u = $('#pkUser').value.trim();
    if (!usuarioValido(u)) { renderPickUser('Usuário inválido: use de 3 a 30 letras minúsculas, números, ponto, hífen ou _.'); return; }
    $('#pickForm button[type=submit]').disabled = true;
    try {
      await api.adminUsers({ action: 'meu-usuario', username: u });
      toast(`Pronto! Agora entre sempre com o usuário ${u}.`, 6000);
      await startApp();
    } catch (err) {
      const c = String(err?.message || err);
      renderPickUser(c.includes('usuario_em_uso') ? 'Este usuário já existe. Escolha outro.' : 'Não foi possível salvar. Verifique a internet e tente de novo.');
      $('#pkUser').value = u;
    }
  };
  setTimeout(() => $('#pkUser')?.focus(), 60);
}

/* primeiro acesso: completar cadastro e trocar a senha temporária */
async function renderSetup(msg = '') {
  $('#app').hidden = true; $('.nav').hidden = true; $('#auth').hidden = false;
  const p = S.profile || {};
  const cpf0 = await api.loadCpf().catch(() => '');
  $('#auth').innerHTML = `
    <div><div class="brand"><b>RN</b> Group</div><div class="sub">Bem-vindo! Complete seu cadastro para começar.</div></div>
    <form id="setupForm" novalidate>
      <h2 style="margin:0">Complete seu cadastro</h2>
      ${p.username ? `<div class="note">Seu usuário: <b>${esc(p.username)}</b> (é com ele que você entra)</div>` : ''}
      <label class="f">Nome completo<input class="inp" id="sName" required maxlength="80" autocomplete="name" value="${esc(p.name || '')}"></label>
      <label class="f">E-mail<input class="inp" id="sMail" type="email" required inputmode="email" autocomplete="email" value="${esc(p.email || '')}"></label>
      <label class="f">CPF<input class="inp" id="sCpf" required inputmode="numeric" placeholder="000.000.000-00" maxlength="14" value="${esc(mascaraCpf(cpf0))}"></label>
      <label class="f">Crie sua senha<input class="inp" id="sPass" type="password" required minlength="6" autocomplete="new-password"></label>
      <span class="note" style="margin-top:-6px">Mínimo de 6 caracteres, com letra maiúscula e minúscula.</span>
      <label class="f">Confirme a senha<input class="inp" id="sPass2" type="password" required minlength="6" autocomplete="new-password"></label>
      <p class="err" role="alert" id="sErr" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <button class="btn" type="submit" style="padding:14px">Salvar e entrar</button>
    </form>
    <button type="button" class="link" id="sOut">Sair</button>`;
  $('#sCpf').oninput = (e) => { e.target.value = mascaraCpf(e.target.value); };
  $('#sOut').onclick = async () => { await api.signOut(); location.reload(); };
  let pwdSet = null;
  const fail = (m) => { $('#sErr').textContent = m; $('#sErr').hidden = false; $('#setupForm button[type=submit]').disabled = false; };
  $('#setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#sName').value.trim().replace(/\s+/g, ' '), email = $('#sMail').value.trim().toLowerCase(), cpf = soNumeros($('#sCpf').value);
    const pass = $('#sPass').value, pass2 = $('#sPass2').value;
    if (name.length < 3 || !name.includes(' ')) return fail('Digite seu nome completo (nome e sobrenome).');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Digite um e-mail válido.');
    if (!cpfValido(cpf)) return fail('CPF inválido. Confira os números.');
    if (!senhaForte(pass)) return fail('A senha precisa ter pelo menos 6 caracteres, com letra maiúscula e minúscula.');
    if (pass !== pass2) return fail('As duas senhas não são iguais.');
    $('#setupForm button[type=submit]').disabled = true;
    try {
      if (pwdSet !== pass) { await api.setPasswordOnly(pass); pwdSet = pass; }
      await api.completeProfile(name, email, cpf);
      S.profile = await api.loadProfile();
      toast('Cadastro concluído!');
      await startApp();
    } catch (err) { fail(traduz(err)); }
  };
}
const traduz = (e) => {
  const m = String(e?.message || e);
  if (/Invalid login/i.test(m)) return 'Usuário ou senha incorretos.';
  if (/already registered/i.test(m)) return 'Este e-mail já tem conta. Use Entrar.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).';
  if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/different from the old/i.test(m)) return 'A nova senha precisa ser diferente da senha temporária.';
  if (/nome_incompleto/.test(m)) return 'Digite seu nome completo (nome e sobrenome).';
  if (/email_invalido/.test(m)) return 'Digite um e-mail válido.';
  if (/cpf_invalido/.test(m)) return 'CPF inválido. Confira os números.';
  if (/email_em_uso/.test(m)) return 'Este e-mail já está cadastrado para outra pessoa.';
  if (/cpf_em_uso/.test(m)) return 'Este CPF já está cadastrado para outra pessoa.';
  return 'Não deu certo: ' + m;
};
function newPasswordSheet() {
  const el = sheet('Nova senha', '<label class="f">Nova senha<input class="inp" id="np" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn" type="submit">Salvar senha</button>', { form: true });
  el.onsubmit = safe(async (e) => { e.preventDefault(); if (!senhaForte($('#np').value)) { toast('A senha precisa ter pelo menos 6 caracteres, com letra maiúscula e minúscula.', 5000); return; } await api.setPassword($('#np').value); closeSheet(); toast('Senha alterada'); });
}

let unsub = null;
async function startApp() {
  S.user = await api.session();
  if (!S.user) { renderAuth(); return; }
  await api.afterLogin().catch(() => {});
  S.profile = (await api.loadProfile()) || { name: '', default_alerts: [240, 60, 10], brief_on: true, brief_time: '07:00' };
  if (api.mode === 'cloud' && !S.profile.username) { renderPickUser(); return; }
  if (S.profile.needs_setup) { await renderSetup(); return; }
  $('#auth').hidden = true; $('#app').hidden = false; $('.nav').hidden = false;
  S.push = await pushStatus().catch(() => 'indisponivel');
  refreshPush();
  render();
  await reload();
  unsub?.(); unsub = api.subscribe(reload);
}

/* ---------- início ---------- */
applyTheme(ls.get('rng.theme', 'light'));
registerSW();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.user) renderBanners(); });
api.onAuth((u) => { if (!u && S.user) location.reload(); });
setInterval(checkReminders, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) reload(); });
startApp();
