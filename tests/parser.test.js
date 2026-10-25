import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFala } from '../src/parser.js';
import { nextOccurrence } from '../src/recurrence.js';

const now = new Date(2026, 9, 25, 9, 0); // domingo, 25/10/2026 09:00

test('reunião com convidados, amanhã às 15h', () => {
  const r = parseFala('Marcar reunião com João e Ana amanhã às 15h sobre o orçamento', now);
  assert.equal(r.kind, 'reuniao');
  assert.equal(r.cat, 'empresa');
  assert.equal(r.due, '2026-10-26T15:00');
  assert.deepEqual(r.guests, ['João', 'Ana']);
  assert.equal(r.title, 'Reunião sobre o orçamento');
});
test('lembrete pessoal na sexta', () => {
  const r = parseFala('Me lembra de pagar a luz sexta às 9h', now);
  assert.equal(r.kind, 'lembrete');
  assert.equal(r.due, '2026-10-30T09:00');
  assert.equal(r.title, 'Pagar a luz');
});
test('horário com minutos e período da tarde', () => {
  assert.equal(parseFala('Ligar para o cliente hoje 16:30', now).due, '2026-10-25T16:30');
  assert.equal(parseFala('Comprar remédio dia 30 às 3 da tarde', now).due, '2026-10-30T15:00');
});
test('repetição', () => {
  const r = parseFala('Reunião de equipe toda segunda às 9h', now);
  assert.equal(r.recurrence, 'semanal');
  assert.equal(r.due, '2026-10-26T09:00');
  assert.equal(r.title, 'Reunião de equipe');
  assert.equal(parseFala('tomar remédio todo dia às 8h', now).recurrence, 'diaria');
});
test('próxima ocorrência', () => {
  const d = new Date(2026, 9, 23, 9, 0); // sexta
  assert.equal(new Date(nextOccurrence(d.toISOString(), 'dias_uteis', d)).getDay(), 1);
  assert.equal(new Date(nextOccurrence(d.toISOString(), 'semanal', new Date(2026, 9, 25))).getDate(), 30);
});
test('toda segunda com data explícita não sobra no título', () => {
  const r = parseFala('Reunião com João amanhã às 15h sobre o orçamento toda segunda', now);
  assert.equal(r.title, 'Reunião sobre o orçamento');
  assert.equal(r.recurrence, 'semanal');
  assert.equal(r.due, '2026-10-26T15:00');
});
