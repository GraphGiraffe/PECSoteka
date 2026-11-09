export const MAX_RECORDING_SECONDS = 30;
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const Context = () => window.AudioContext || window.webkitAudioContext;

export async function decodeRecording(blob, context) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > 20 * 1024 * 1024) throw Error('Выберите аудиофайл размером до 20 МБ');
  if (!Context()) throw Error('Этот браузер не поддерживает обработку аудиозаписей');
  const owned = !context, ctx = context || new (Context())();
  try {
    let buffer;
    try { buffer = await ctx.decodeAudioData(await blob.arrayBuffer()); }
    catch { throw Error('Не удалось прочитать запись. Попробуйте WAV, MP3 или M4A'); }
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > MAX_RECORDING_SECONDS + .2) throw Error(`Озвучка карточки должна быть не длиннее ${MAX_RECORDING_SECONDS} секунд`);
    return buffer;
  } finally { if (owned) await ctx.close(); }
}

// Store a portable mono PCM WAV, regardless of the recorder's browser container.
export async function prepareRecording(file) {
  const buffer = await decodeRecording(file), rate = 22050;
  const count = Math.max(1, Math.ceil(buffer.duration * rate)), bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < count; i++) {
    const position = Math.min(buffer.length - 1, i * buffer.sampleRate / rate), a = Math.floor(position), b = Math.min(a + 1, buffer.length - 1), fraction = position - a;
    let value = 0;
    for (const channel of channels) value += channel[a] + (channel[b] - channel[a]) * fraction;
    value = Math.max(-1, Math.min(1, value / channels.length));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return { blob: new Blob([bytes], { type: 'audio/wav' }), duration: buffer.duration };
}

export class CardPlayback {
  constructor(speech, status) { this.speech = speech; this.status = status; this.token = 0; this.active = false; this.context = null; this.source = null; this.finish = null; }
  stop() {
    this.token++; this.active = false;
    this.speech.stop();
    const source = this.source; this.source = null;
    if (source) { try { source.stop(); } catch {} source.disconnect(); }
    this.finish?.(); this.finish = null; this.status(false);
  }
  async play(cards, recordings, settings) {
    this.stop();
    if (!cards.length) return;
    const mode = settings.speechMode;
    if (mode === 'recordings') {
      const missing = cards.filter(c => !c.audioId || !recordings.has(c.audioId));
      if (missing.length) throw Error(`Нет записи для карточки «${missing[0].title}». Добавьте её в редакторе или выберите режим с синтезом речи`);
    }
    const units = [];
    for (const card of cards) {
      if (mode !== 'tts' && card.audioId) {
        const blob = recordings.get(card.audioId);
        if (!blob) throw Error(`Не найдена запись карточки «${card.title}»`);
        units.push({ blob });
      } else if (units.at(-1)?.text !== undefined) units.at(-1).text += ' ' + card.speechText;
      else units.push({ text: card.speechText });
    }
    this.speech.settings = settings;
    if (units.length === 1 && units[0].text !== undefined) return this.speech.say(units[0].text);
    if (!Context()) throw Error('Этот браузер не поддерживает воспроизведение записей');
    this.context ||= new (Context())();
    // Resume in the original click, before any decode or voice-discovery await.
    const resumed = this.context.resume(), token = this.token;
    this.active = true; this.status(true);
    try {
      await resumed;
      // Decode before playing so a bad clip cannot leave a partially spoken message.
      const decoded = await Promise.all(units.map(unit => unit.blob ? decodeRecording(unit.blob, this.context) : null));
      if (token !== this.token) return;
      for (let i = 0; i < units.length; i++) {
        if (token !== this.token) return;
        if (units[i].text !== undefined) await this.speech.say(units[i].text, { waitForEnd: true });
        else await new Promise(resolve => {
          const source = this.context.createBufferSource(), gain = this.context.createGain();
          source.buffer = decoded[i]; gain.gain.value = settings.speechVolume;
          source.connect(gain); gain.connect(this.context.destination); this.source = source;
          const finish = () => { source.disconnect(); gain.disconnect(); if (this.source === source) this.source = null; if (this.finish === finish) this.finish = null; resolve(); };
          this.finish = finish; source.onended = finish; source.start();
        });
      }
    } catch (error) { if (token === this.token) throw error; }
    finally { if (token === this.token) { this.active = false; this.status(false); } }
  }
}

export class CardRecorder {
  constructor({ ready, tick, complete, error }) { this.callbacks = { ready, tick, complete, error }; this.closed = false; this.recorder = null; this.stream = null; this.context = null; }
  async start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('Запись с микрофона недоступна. Откройте приложение по HTTPS или загрузите готовый аудиофайл');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closed) { this.release(); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const chunks = [], recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {}); this.recorder = recorder;
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { this.cancel(); this.callbacks.error(Error('Запись прервана. Проверьте микрофон и попробуйте снова')); };
      recorder.onstop = () => {
        this.release();
        if (!this.closed) this.callbacks.complete(new Blob(chunks, { type: recorder.mimeType }));
      };
      if (Context()) {
        this.context = new (Context())(); this.context.resume().catch(() => {});
        const input = this.context.createMediaStreamSource(this.stream); this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 256; input.connect(this.analyser); this.samples = new Uint8Array(this.analyser.fftSize);
      }
      recorder.start(250); this.started = performance.now(); this.callbacks.ready();
      this.timer = setInterval(() => {
        let level = 0;
        if (this.analyser) { this.analyser.getByteTimeDomainData(this.samples); level = Math.min(1, Math.sqrt(this.samples.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / this.samples.length) * 4); }
        this.callbacks.tick(Math.min(MAX_RECORDING_SECONDS, (performance.now() - this.started) / 1000), level);
      }, 100);
      this.limit = setTimeout(() => this.stop(), MAX_RECORDING_SECONDS * 1000);
    } catch (e) {
      this.release();
      if (this.closed) return;
      throw Error(e.name === 'NotAllowedError' ? 'Доступ к микрофону не разрешён. Разрешите его в настройках сайта или загрузите аудиофайл' : e.name === 'NotFoundError' ? 'Микрофон не найден. Подключите его или загрузите аудиофайл' : 'Не удалось включить микрофон. Проверьте, не занят ли он другим приложением');
    }
  }
  stop() { clearTimeout(this.limit); clearInterval(this.timer); if (this.recorder?.state === 'recording') this.recorder.stop(); }
  release() { clearTimeout(this.limit); clearInterval(this.timer); this.stream?.getTracks().forEach(track => track.stop()); this.context?.close().catch(() => {}); this.context = null; }
  cancel() { this.closed = true; this.stop(); this.release(); }
}
