export function registerSw() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    window.addEventListener('online', () => navigator.serviceWorker.ready.then((r) => r.active.postMessage('sync')));
  }
}

export function isOnline() {
  return navigator.onLine !== false;
}

export function showOfflineToast() {
  const el = document.createElement('div');
  el.textContent = isOnline() ? 'You are back online — changes synced.' : 'You are offline — changes will sync when you reconnect.';
  el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#0f172a;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.25)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
