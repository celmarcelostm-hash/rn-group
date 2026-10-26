// Permissões de grupo, igual à regra do banco (função can_do):
// quem não é membro comum de nenhum grupo, ou é administrador de algum, pode tudo.
export const ALL = { pessoal: true, empresa: true, convite: true };

export function permsFor(groups, uid) {
  const mine = (groups || []).flatMap((g) => (g.group_members || []).filter((m) => m.user_id === uid));
  const membro = mine.filter((m) => m.role === 'membro');
  if (!membro.length || mine.some((m) => m.role === 'admin')) return { ...ALL };
  return {
    pessoal: membro.some((m) => m.can_pessoal),
    empresa: membro.some((m) => m.can_empresa),
    convite: membro.some((m) => m.can_invite),
  };
}
