import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, mascaraCpf, loginEmail, usuarioValido, senhaForte } from '../src/cpf.js';

test('CPF válido e inválido', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('529.982.247-24'), false);
  assert.equal(cpfValido('111.111.111-11'), false);
  assert.equal(cpfValido('123'), false);
});
test('máscara do CPF', () => {
  assert.equal(mascaraCpf('52998224725'), '529.982.247-25');
  assert.equal(mascaraCpf('5299'), '529.9');
  assert.equal(mascaraCpf('529982'), '529.982');
  assert.equal(mascaraCpf('5299822'), '529.982.2');
});
test('login por usuário ou e-mail', () => {
  assert.equal(loginEmail(' Joao.Silva '), 'joao.silva@usuarios.rngroup.app');
  assert.equal(loginEmail('ola@gmail.com'), 'ola@gmail.com');
  assert.equal(usuarioValido('joao.silva'), true);
  assert.equal(usuarioValido('Jo'), false);
  assert.equal(usuarioValido('joão'), false);
});
test('senha forte', () => {
  assert.equal(senhaForte('12345678'), false);
  assert.equal(senhaForte('abcdef'), false);
  assert.equal(senhaForte('Abc12'), false);
  assert.equal(senhaForte('Abcdef'), true);
});
