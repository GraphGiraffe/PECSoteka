// Installation and waiting-worker state stay separate from the user's album.
import { VERSION } from './domain.js';
import { STORAGE_PREFIX } from './config.js';

const versionParts = v => {
  const match = typeof v === 'string' && /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/.exec(v);
  return match ? [...match.slice(1, 4).map(Number), match[4]?.split('.') || []] : null;
};
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  if (!a[3].length || !b[3].length) return a[3].length ? -1 : b[3].length ? 1 : 0;
  for (let i = 0; i < Math.max(a[3].length, b[3].length); i++) {
    const x = a[3][i], y = b[3][i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? Number(x) - Number(y) : xn !== yn ? xn ? -1 : 1 : x < y ? -1 : 1;
  }
  return 0;
};
export function releasesBetween(history, current, target) {
  const from = versionParts(current), to = versionParts(target);
  if (!from || !to || !Array.isArray(history)) return [];
  const unique = new Map();
  for (const release of history) {
    const parts = versionParts(release?.version);
    if (!parts || compare(parts, from) <= 0 || compare(parts, to) > 0 || !Array.isArray(release.changes)) continue;
    const changes = release.changes.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
    if (changes.length) unique.set(release.version, { version: release.version, changes });
  }
  return [...unique.values()].sort((a, b) => compare(versionParts(a.version), versionParts(b.version)));
}

export class PWAController {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.displayMode = matchMedia('(display-mode: standalone)');
    this.installed = this.standalone() || this.read('installed') === 'yes';
    this.prompt = null; this.registration = null; this.waiting = null;
    this.updateId = ''; this.releases = []; this.notifiedId = this.read('notified-update'); this.applying = false;
    if (this.standalone()) this.write('installed', 'yes');
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      if (this.standalone()) return;
      // A fresh install offer also clears an old marker after uninstallation.
      this.prompt = e; this.setInstalled(false);
    });
    window.addEventListener('appinstalled', () => { this.prompt = null; this.setInstalled(true); });
    this.displayMode.addEventListener('change', () => { if (this.standalone()) this.setInstalled(true); });
    window.addEventListener('storage', e => {
      if (e.key === 'pecsoteka-installed') { this.installed = this.standalone() || e.newValue === 'yes'; this.onChange(); }
    });
  }
  standalone() { return this.displayMode.matches || navigator.standalone === true; }
  read(key) { try { return localStorage.getItem(`${STORAGE_PREFIX}${key}`) || ''; } catch { return ''; } }
  write(key, value) { try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, value); } catch { /* RAM state still works when metadata storage is blocked. */ } }
  setInstalled(value) { this.installed = value; this.write('installed', value ? 'yes' : ''); this.onChange(); }
  get hasUpdate() { return !!this.waiting; }
  get shouldNotify() { return this.hasUpdate && !!this.updateId && this.updateId !== this.notifiedId && this.updateId !== this.read('notified-update'); }
  markNotified() { this.notifiedId = this.updateId; this.write('notified-update', this.updateId); }
  async install() {
    if (this.installed) return true;
    if (!this.prompt) return false;
    const prompt = this.prompt; this.prompt = null;
    await prompt.prompt();
    // Installation is confirmed by appinstalled / standalone, not by clicking.
    return true;
  }
  async start() {
    if (!('serviceWorker' in navigator) || !isSecureContext) return;
    this.registration = await navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (this.applying) location.reload(); });
    const watch = worker => {
      if (!worker) return;
      worker.addEventListener('statechange', () => { if (worker.state === 'installed') this.refreshWaiting(); });
    };
    this.registration.addEventListener('updatefound', () => watch(this.registration.installing));
    watch(this.registration.installing);
    await this.refreshWaiting();
  }
  async refreshWaiting() {
    const worker = this.registration?.waiting;
    if (!worker) { this.waiting = null; this.updateId = ''; this.releases = []; this.onChange(); return; }
    const info = await new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
      const timer = setTimeout(() => finish({ version: worker.scriptURL }), 1200);
      channel.port1.onmessage = e => finish(e.data && typeof e.data === 'object' ? e.data : { version: worker.scriptURL });
      try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]); }
      catch { finish({ version: worker.scriptURL }); }
    });
    if (this.registration.waiting !== worker) return;
    this.waiting = worker; this.updateId = typeof info.version === 'string' ? info.version : worker.scriptURL;
    this.releases = releasesBetween(info.releases, VERSION, info.appVersion);
    this.onChange();
  }
  async check() {
    if (!this.registration) return false;
    await this.registration.update();
    await this.refreshWaiting();
    return true;
  }
  apply() {
    const worker = this.registration?.waiting;
    if (!worker || this.applying) return false;
    this.applying = true;
    worker.postMessage('ACTIVATE');
    return true;
  }
}
