export class Feedback {
  constructor(settings) { this.settings = settings; this.context = null; }
  async play(kind) {
    if (!this.settings.actionSounds || !this.settings.soundVolume) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.context ||= new Ctx();
      if (this.context.state === 'suspended') await this.context.resume();
      const notes = { lift: [330], place: [440, 554], return: [392, 330], mode: [440, 660] }[kind] || [440];
      const at = this.context.currentTime;
      notes.forEach((frequency, i) => {
        const oscillator = this.context.createOscillator(), gain = this.context.createGain(), start = at + i * .075;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.13 * this.settings.soundVolume, start + .012); gain.gain.exponentialRampToValueAtTime(.001, start + .12);
        oscillator.connect(gain); gain.connect(this.context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + .14);
      });
    } catch { /* Audio availability must never block communication. */ }
  }
}
export class Speech {
  constructor(settings, status) { this.settings = settings; this.status = status; this.token = 0; }
  voices() { return window.speechSynthesis?.getVoices().filter(v => v.lang.toLowerCase().startsWith('ru')) || []; }
  stop() { this.token++; window.speechSynthesis?.cancel(); this.status(false); }
  say(text) {
    this.stop();
    if (!text) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw Error('На этом устройстве нет синтеза речи');
    const token = this.token, u = new SpeechSynthesisUtterance(text), s = this.settings;
    const voice = this.voices().find(v => v.voiceURI === s.voiceURI) || this.voices()[0];
    if (!voice) throw Error('Русский голос не найден. Добавьте его в настройках устройства.');
    u.voice = voice; u.lang = s.voiceLang; u.rate = s.rate; u.pitch = s.pitch; u.volume = s.speechVolume;
    u.onstart = () => { if (this.token === token) this.status(true); };
    u.onend = u.onerror = () => { if (this.token === token) this.status(false); };
    window.speechSynthesis.speak(u);
  }
}
export async function readPhoto(file) {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw Error('Выберите изображение размером до 20 МБ');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (bitmap.width > 16000 || bitmap.height > 16000 || bitmap.width * bitmap.height > 80e6) { bitmap.close(); throw Error('Слишком большое разрешение изображения'); }
  return bitmap;
}
export async function cropPhoto(bitmap, zoom = 1, x = 50, y = 50) {
  const side = Math.min(bitmap.width, bitmap.height) / zoom;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 768;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) * x / 100, (bitmap.height - side) * y / 100, side, side, 0, 0, 768, 768);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85));
  if (!blob) throw Error('Не удалось обработать фото');
  return blob;
}
