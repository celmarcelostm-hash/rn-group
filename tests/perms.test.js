import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permsFor } from '../src/perms.js';

const g = (members) => ({ id: 'g', group_members: members });
const m = (user_id, role, p = {}) => ({ user_id, role, can_pessoal: true, can_empresa: true, can_invite: true, ...p });

test('sem grupo pode tudo', () => {
  assert.deepEqual(permsFor([], 'u'), { pessoal: true, empresa: true, convite: true });
});
test('administrador pode tudo', () => {
  assert.deepEqual(permsFor([g([m('u', 'admin', { can_pessoal: false })])], 'u'), { pessoal: true, empresa: true, convite: true });
});
test('membro segue o que o administrador liberou', () => {
  const gs = [g([m('a', 'admin'), m('u', 'membro', { can_pessoal: false, can_invite: false })])];
  assert.deepEqual(permsFor(gs, 'u'), { pessoal: false, empresa: true, convite: false });
});
test('em dois grupos, vale o que algum liberar', () => {
  const gs = [g([m('u', 'membro', { can_empresa: false })]), g([m('u', 'membro', { can_pessoal: false })])];
  assert.deepEqual(permsFor(gs, 'u'), { pessoal: true, empresa: true, convite: true });
});
