import { CardRecorder, prepareRecording, MAX_RECORDING_SECONDS } from './audio.js';

export class CardAudioEditor {
  constructor(container, blob, playback, settings, dirty) {
    this.container = container; this.blob = blob; this.initialBlob = blob; this.oldBlob = blob; this.newBlob = null; this.choice = 'old'; this.playback = playback; this.settings = settings; this.dirty = dirty;
    this.changed = false; this.phase = 'idle'; this.generation = 0; this.recorder = null; this.closed = false;
    container.innerHTML = `<section class="recording-panel" aria-label="Озвучка карточки">
      <h3 class="section-title">Своя озвучка</h3><p class="note" id="recording-status" role="status"></p>
      <div class="recording-live" id="recording-live" hidden><span class="recording-dot" aria-hidden="true"></span><output id="recording-time">0:00</output><meter id="recording-level" min="0" max="1" value="0" aria-label="Уровень микрофона"></meter></div>
      <div class="row recording-buttons"><button type="button" class="button secondary" id="record-start">Записать</button><button type="button" class="button" id="record-stop" hidden>Завершить запись</button><button type="button" class="button ghost" id="record-cancel" hidden>Отменить запись</button><button type="button" class="button ghost" id="audio-upload">Аудиофайл</button></div>
      <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" id="audio-file" hidden>
      <fieldset id="recording-choice" class="recording-choice" hidden><legend>Какую озвучку сохранить?</legend>
        <div class="recording-take"><label class="check"><input type="radio" name="recordingChoice" value="old">Старую запись</label><button type="button" class="button ghost" id="audio-old-preview">Прослушать старую</button></div>
        <div class="recording-take"><label class="check"><input type="radio" name="recordingChoice" value="new">Новую запись</label><button type="button" class="button ghost" id="audio-new-preview">Прослушать новую</button></div>
      </fieldset>
      <div class="row"><button type="button" class="button secondary" id="audio-preview">Прослушать</button><button type="button" class="button ghost" id="audio-remove">Убрать озвучку</button></div>
      <p class="error" id="audio-error" aria-live="polite"></p></section>`;
    this.$ = selector => container.querySelector(selector);
    this.$('#record-start').onclick = () => this.start();
    this.$('#record-stop').onclick = () => { this.phase = 'processing'; this.render(); this.recorder?.stop(); };
    this.$('#record-cancel').onclick = () => this.cancel();
    this.$('#audio-upload').onclick = () => this.$('#audio-file').click();
    this.$('#audio-file').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (file) { playback.stop(); this.accept(file); } };
    this.$('#audio-preview').onclick = () => this.preview();
    this.$('#audio-old-preview').onclick = () => this.preview(this.oldBlob, this.$('#audio-old-preview'));
    this.$('#audio-new-preview').onclick = () => this.preview(this.newBlob, this.$('#audio-new-preview'));
    this.$('#recording-choice').onchange = e => {
      if (this.busy) return;
      playback.stop(); this.choice = e.target.value; this.blob = this.choice === 'old' ? this.oldBlob : this.newBlob;
      this.changed = this.blob !== this.initialBlob; this.dirty(); this.render();
    };
    this.$('#audio-remove').onclick = () => { playback.stop(); this.blob = this.oldBlob = this.newBlob = null; this.duration = 0; this.changed = this.initialBlob !== null; this.dirty(); this.render(); };
    this.onHidden = () => { if (document.hidden && this.busy) this.cancel(); };
    document.addEventListener('visibilitychange', this.onHidden); this.render();
  }
  get busy() { return this.phase !== 'idle'; }
  render() {
    if (this.closed) return;
    const supported = !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
    this.$('#record-start').disabled = this.busy || !supported;
    this.$('#record-start').textContent = this.blob ? 'Записать заново' : 'Записать';
    this.$('#audio-upload').disabled = this.busy; this.$('#audio-preview').disabled = this.busy || !this.blob;
    this.$('#audio-remove').hidden = !this.blob; this.$('#audio-remove').disabled = this.busy;
    this.$('#record-stop').hidden = this.phase !== 'recording'; this.$('#record-cancel').hidden = !this.busy;
    this.$('#recording-live').hidden = this.phase !== 'recording';
    const compare = !!this.oldBlob && !!this.newBlob;
    this.$('#recording-choice').hidden = !compare; this.$('#audio-preview').hidden = compare;
    for (const radio of this.container.querySelectorAll('[name=recordingChoice]')) { radio.checked = radio.value === this.choice; radio.disabled = this.busy; }
    this.$('#audio-old-preview').disabled = this.$('#audio-new-preview').disabled = this.busy;
    this.container.closest('form').querySelector('[type=submit]').disabled = this.busy;
    this.$('#recording-status').textContent = this.phase === 'requesting' ? 'Разрешите доступ к микрофону…' : this.phase === 'recording' ? 'Говорите. Затем завершите запись.' : this.phase === 'processing' ? 'Подготавливаем озвучку…' : this.blob ? `${this.choice === 'new' && this.duration ? this.duration.toFixed(1) + ' с · ' : ''}Запись готова${this.changed ? '. Сохраните карточку.' : '.'}` : `Запишите голос или выберите аудиофайл. До ${MAX_RECORDING_SECONDS} секунд.${supported ? '' : ' Запись с микрофона в этом браузере недоступна.'}`;
  }
  cancel() { this.generation++; this.recorder?.cancel(); this.recorder = null; this.phase = 'idle'; this.render(); }
  async accept(file) {
    const gen = ++this.generation; this.phase = 'processing'; this.render(); this.$('#audio-error').textContent = '';
    try {
      const result = await prepareRecording(file);
      if (gen !== this.generation || this.closed) return;
      this.oldBlob ||= this.blob;
      this.newBlob = result.blob; this.blob = result.blob; this.choice = 'new'; this.duration = result.duration; this.changed = this.blob !== this.initialBlob; this.dirty();
    } catch (e) { if (gen === this.generation && !this.closed) this.$('#audio-error').textContent = e.message; }
    finally { if (gen === this.generation && !this.closed) { this.phase = 'idle'; this.render(); } }
  }
  async start() {
    this.playback.stop(); this.$('#audio-error').textContent = ''; this.phase = 'requesting'; this.render();
    const current = new CardRecorder({
      ready: () => { if (this.closed) return; this.phase = 'recording'; this.dirty(); this.$('#recording-time').textContent = '0:00'; this.render(); },
      tick: (seconds, level) => { if (!this.closed) { this.$('#recording-time').textContent = `0:${String(Math.floor(seconds)).padStart(2, '0')} / 0:${MAX_RECORDING_SECONDS}`; this.$('#recording-level').value = level; } },
      complete: file => { if (!this.closed && this.recorder === current) this.accept(file); },
      error: e => { if (!this.closed && this.recorder === current) { this.phase = 'idle'; this.render(); this.$('#audio-error').textContent = e.message; } }
    }); this.recorder = current;
    try { await current.start(); }
    catch (e) { if (!this.closed && this.recorder === current) { this.phase = 'idle'; this.render(); this.$('#audio-error').textContent = e.message; } }
  }
  async preview(blob = this.blob, button = this.$('#audio-preview')) {
    const label = button.id === 'audio-old-preview' ? 'Прослушать старую' : button.id === 'audio-new-preview' ? 'Прослушать новую' : 'Прослушать';
    const ticket = (this.previewTicket || 0) + 1; this.previewTicket = ticket;
    this.$('#audio-preview').textContent = 'Прослушать'; this.$('#audio-old-preview').textContent = 'Прослушать старую'; this.$('#audio-new-preview').textContent = 'Прослушать новую';
    if (this.playback.active && this.previewBlob === blob) { this.playback.stop(); button.textContent = label; return; }
    this.playback.stop(); this.previewBlob = blob;
    button.textContent = 'Остановить';
    try { await this.playback.play([{ title: 'Предпросмотр', speechText: '', audioId: 'draft' }], new Map([['draft', blob]]), { ...this.settings, speechMode: 'recordings' }); }
    catch (e) { if (!this.closed) this.$('#audio-error').textContent = e.message; }
    finally { if (!this.closed && this.previewTicket === ticket) button.textContent = label; }
  }
  dispose() { this.closed = true; this.cancel(); this.playback.stop(); document.removeEventListener('visibilitychange', this.onHidden); }
}
