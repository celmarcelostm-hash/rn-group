// Próxima ocorrência de um item que se repete. Mesmo cálculo usado no app (src/recurrence.js).
export function nextOccurrence(dueIso: string, rule: string, after = new Date()): string {
  const d = new Date(dueIso);
  const step = () => {
    if (rule === "diaria") d.setUTCDate(d.getUTCDate() + 1);
    else if (rule === "semanal") d.setUTCDate(d.getUTCDate() + 7);
    else if (rule === "mensal") d.setUTCMonth(d.getUTCMonth() + 1);
    else if (rule === "dias_uteis") {
      do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(localDow(d)));
    } else throw new Error("regra desconhecida");
  };
  step();
  let guard = 0;
  while (d <= after && guard++ < 1000) step();
  return d.toISOString();
}
// Dia da semana no horário de Brasília (UTC-3), suficiente para "dias úteis".
function localDow(d: Date) {
  return new Date(d.getTime() - 3 * 3600_000).getUTCDay();
}
