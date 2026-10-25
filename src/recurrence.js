// Próxima ocorrência de um item que se repete (mesma regra do servidor).
export const RECURRENCE = [
  ['', 'Não repete'],
  ['diaria', 'Todo dia'],
  ['dias_uteis', 'Dias úteis (seg. a sex.)'],
  ['semanal', 'Toda semana'],
  ['mensal', 'Todo mês'],
];
export const recurrenceLabel = (r) => (RECURRENCE.find((x) => x[0] === (r || '')) || RECURRENCE[0])[1];

export function nextOccurrence(dueIso, rule, after = new Date()) {
  const d = new Date(dueIso);
  const step = () => {
    if (rule === 'diaria') d.setDate(d.getDate() + 1);
    else if (rule === 'semanal') d.setDate(d.getDate() + 7);
    else if (rule === 'mensal') d.setMonth(d.getMonth() + 1);
    else if (rule === 'dias_uteis') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else throw new Error('regra desconhecida');
  };
  step();
  let guard = 0;
  while (d <= after && guard++ < 1000) step();
  return d.toISOString();
}
