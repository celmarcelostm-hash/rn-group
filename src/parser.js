// Interpreta uma frase falada em português e monta a tarefa:
// tipo (tarefa, lembrete, reunião), categoria, dia, horário, convidados e título.
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function norm(s){ return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
export function parseFala(raw, now = new Date()){
  let t = ' ' + norm(raw.trim()) + ' ';
  const out = { heard: raw.trim(), kind:'tarefa', cat:null, due:null, guests:[] };
  if (/\b(reuniao|encontro|call|meet)\b/.test(t)) out.kind='reuniao';
  else if (/\b(lembr|lembrete|avisa)/.test(t)) out.kind='lembrete';
  if (/\b(empresa|trabalho|cliente|escritorio|equipe|fornecedor|orcamento|venda)/.test(t)) out.cat='empresa';
  else if (/\b(pessoal|casa|familia|medico|academia|mercado|filho|filha|esposa|marido)/.test(t)) out.cat='pessoal';
  out.cat ||= out.kind==='reuniao' ? 'empresa' : 'pessoal';
  // repetição
  out.recurrence = ''; let wdRec = null;
  t = t.replace(/\b(segunda|terca|quarta|quinta|sexta)s\b/g, '$1').replace(/\b(sabado|domingo)s\b/g, '$1');
  if (/\b(todo dia|todos os dias|diariamente)\b/.test(t)) { out.recurrence='diaria'; t=t.replace(/\b(todo dia|todos os dias|diariamente)\b/,' '); }
  else if (/\bdias? uteis\b/.test(t)) { out.recurrence='dias_uteis'; t=t.replace(/\b(em |nos |todos os )?dias? uteis\b/,' '); }
  else if (/\b(todo mes|todos os meses|mensalmente)\b/.test(t)) { out.recurrence='mensal'; t=t.replace(/\b(todo mes|todos os meses|mensalmente)\b/,' '); }
  else if (/\b(toda semana|semanalmente|toda|todo|todas as|todos os) ?(segunda|terca|quarta|quinta|sexta|sabado|domingo)?\b/.test(t) && /\b(toda semana|semanalmente|(toda|todas as|todo|todos os) (segunda|terca|quarta|quinta|sexta|sabado|domingo))\b/.test(t)) {
    out.recurrence='semanal'; t=t.replace(/\b(toda semana|semanalmente)\b/,' ');
    const mw = t.match(/\b(toda|todas as|todo|todos os) (segunda|terca|quarta|quinta|sexta|sabado|domingo)(-feira| feira)?\b/);
    if (mw) { wdRec = mw[2]; t = t.replace(mw[0], ' '); }
  }
  // data
  let d = null;
  const rm = re => { t = t.replace(re, ' '); };
  if (/\bdepois de amanha\b/.test(t)) { d=new Date(now); d.setDate(d.getDate()+2); rm(/\bdepois de amanha\b/); }
  else if (/\bamanha\b/.test(t)) { d=new Date(now); d.setDate(d.getDate()+1); rm(/\b(de )?amanha\b/); }
  else if (/\bhoje\b/.test(t)) { d=new Date(now); rm(/\bhoje\b/); }
  else {
    const wd = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
    const m = t.match(/\b(na |no |nesta |neste |proxima |proximo )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(-feira| feira)?\b/);
    if (m) { const target = wd.indexOf(m[2]); d=new Date(now); let add=(target-d.getDay()+7)%7; if(add===0) add=7; d.setDate(d.getDate()+add); rm(m[0]); }
    const md = t.match(/\bdia (\d{1,2})( de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))?\b/);
    if (md) { const ms=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
      d=new Date(now); const mon = md[3] ? ms.indexOf(md[3]) : d.getMonth(); d.setMonth(mon, +md[1]); if (d < new Date(now.getFullYear(),now.getMonth(),now.getDate())) d.setFullYear(d.getFullYear()+(md[3]?1:0)), md[3]||d.setMonth(d.getMonth()+1, +md[1]); rm(md[0]); }
  }
  if (!d && wdRec) { const wd = ['domingo','segunda','terca','quarta','quinta','sexta','sabado']; d = new Date(now); let add = (wd.indexOf(wdRec) - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); }
  // hora
  let time = null;
  let mh = t.match(/\b(as|a|ao|para as|pelas?|umas?)?\s*(\d{1,2})(?:[:h]\s?(\d{2}))?\s*(h|hs|horas?)?\s*(da manha|da tarde|da noite)?\b/);
  const hasHour = mh && (mh[1] || mh[3] || mh[4] || mh[5]);
  if (/\bmeio[- ]dia\b/.test(t)) { time='12:00'; rm(/\b(ao |as )?meio[- ]dia( e meia)?\b/); }
  else if (hasHour) { let h=+mh[2], mi=mh[3]?+mh[3]:0; if (/e meia/.test(t.slice(t.indexOf(mh[0])+mh[0].length, t.indexOf(mh[0])+mh[0].length+8))) { mi=30; rm(/\be meia\b/); }
    if (mh[5] && /tarde|noite/.test(mh[5]) && h<12) h+=12;
    if (h<=23 && mi<=59) { time = pad(h)+':'+pad(mi); rm(mh[0]); } }
  if (time && !d) { d = new Date(now); const [h,mi]=time.split(':'); const c=new Date(now); c.setHours(+h,+mi,0,0); if (c<now) d.setDate(d.getDate()+1); }
  if (d) out.due = ymd(d) + (time ? 'T'+time : '');
  // pessoas: "com joão e maria"
  const mg = t.match(/\bcom (?:o |a |os |as )?([a-z][a-z ,]*?)(?= sobre | para | pra | no | na | em |$|\s{2,})/);
  if (mg && out.kind==='reuniao') { const om = {}; raw.split(/\s+/).forEach(w=>{ const k=norm(w).replace(/[^\w]/g,''); if(k) om[k]=w.replace(/[.,!?]+$/,''); });
    out.guests = mg[1].split(/,| e /).map(s=>s.trim()).filter(Boolean).map(s=>s.split(' ').map(w=>{ const o=om[w]||w; return o[0].toUpperCase()+o.slice(1); }).join(' ')).slice(0,8); rm(mg[0]); }
  // título
  t = t.replace(/\b(me )?(lembra|lembre|lembrar|lembrete|avisa|avise)( me)?( de| para| pra| que)?\b/g,' ')
       .replace(/\b(criar|crie|cria|anotar|anota|adicionar|adiciona|nova|novo)( uma| um)?( tarefa| lembrete)?( de| para| pra)?\b/g,' ')
       .replace(/\b(marcar|marca|marque|agendar|agenda)( uma| um)?\b/g,' ')
       .replace(/\b(tarefa|pessoal|da empresa|na empresa|do trabalho|no trabalho)\b/g,' ')
       .replace(/\s+(de|para|pra|as|no|na)\s*$/,' ')
       .replace(/\s+/g,' ').trim();
  // reaproveita acentos da fala original quando possível
  const words = raw.trim().split(/\s+/); const map = {}; words.forEach(w=>{ const k=norm(w).replace(/[^\w]/g,''); if(k) map[k]=w.replace(/[.,!?]+$/,''); });
  let title = t.split(' ').map(w=>map[w]||w).join(' ');
  if (out.kind==='reuniao' && !/reuni/i.test(norm(title))) title = 'Reunião' + (title ? ' ' + title : '');
  out.title = title ? title[0].toUpperCase()+title.slice(1) : '';
  if (!out.due) out.noDate = true;
  return out;
}
