// Notificações push: registra o service worker e inscreve o aparelho.
import { api } from './api.js';

// A chave pública do push vem da variável de ambiente ou, se não houver, do servidor.
let VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || null;
async function vapid() {
  if (!VAPID && api.mode === 'cloud') VAPID = await api.getConfig('vapid_public_key').catch(() => null);
  return VAPID;
}

export const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.warn('service worker', e); return null; }
}

/** 'ativo' | 'desligado' | 'bloqueado' | 'instalar' (iPhone fora da tela de início) | 'indisponivel' */
export async function pushStatus() {
  if (api.mode !== 'cloud' || !(await vapid())) return 'indisponivel';
  if (isIOS && !isStandalone()) return 'instalar';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'indisponivel';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'ativo' : 'desligado';
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(await vapid()) });
  await api.savePush(sub);
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await api.removePush(sub.endpoint); await sub.unsubscribe(); }
}

/** Mantém a inscrição salva no servidor (ex.: depois de trocar de conta). */
export async function refreshPush() {
  if ((await pushStatus()) !== 'ativo') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await api.savePush(sub).catch(() => {});
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
