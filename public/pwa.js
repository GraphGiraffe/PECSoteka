// Installation and waiting-worker state stay separate from the user's album.
export class PWAController {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.displayMode = matchMedia('(display-mode: standalone)');
    this.installed = this.standalone() || this.read('installed') === 'yes';
    this.prompt = null; this.registration = null; this.waiting = null;
    this.updateId = ''; this.notifiedId = this.read('notified-update'); this.applying = false;
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
  read(key) { try { return localStorage.getItem(`pecsoteka-${key}`) || ''; } catch { return ''; } }
  write(key, value) { try { localStorage.setItem(`pecsoteka-${key}`, value); } catch { /* RAM state still works when metadata storage is blocked. */ } }
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
    if (!worker) { this.waiting = null; this.updateId = ''; this.onChange(); return; }
    const id = await new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
      const timer = setTimeout(() => finish(worker.scriptURL), 1200);
      channel.port1.onmessage = e => finish(typeof e.data?.version === 'string' ? e.data.version : worker.scriptURL);
      try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]); }
      catch { finish(worker.scriptURL); }
    });
    if (this.registration.waiting !== worker) return;
    this.waiting = worker; this.updateId = id; this.onChange();
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
