// CPF: só números, máscara e dígitos verificadores
export const soNumeros = (s) => String(s || '').replace(/\D/g, '');

export function mascaraCpf(s) {
  const d = soNumeros(s).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export function cpfValido(s) {
  const c = soNumeros(s);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += +c[i] * (n + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === +c[9] && dv(10) === +c[10];
}

// Login: quem digita só o usuário entra com o e-mail interno
export const LOGIN_DOMAIN = 'usuarios.rngroup.app';
export const loginEmail = (u) => {
  const v = String(u || '').trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`;
};
export const usuarioValido = (u) => /^[a-z0-9._-]{3,30}$/.test(String(u || ''));

// Senha criada pela pessoa: 6+ caracteres com maiúscula e minúscula
export const senhaForte = (p) => typeof p === 'string' && p.length >= 6 && /[a-z]/.test(p) && /[A-Z]/.test(p);
