import { createAlbum, validateAlbum } from './domain.js';
import { DATABASE_NAME } from './config.js';
import { decodeRecording, MAX_AUDIO_BYTES } from './audio.js';

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || Error('Изменения не сохранены')); });
export class AlbumRepository {
  async open() {
    const r = indexedDB.open(DATABASE_NAME, 2);
    r.onupgradeneeded = () => {
      for (const name of ['album', 'images', 'recordings']) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    this.db = await req(r);
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async load() {
    const tx = this.db.transaction(['album', 'images', 'recordings'], 'readonly'), complete = done(tx);
    const [value, keys, blobs, audioKeys, audioBlobs] = await Promise.all([req(tx.objectStore('album').get('current')), req(tx.objectStore('images').getAllKeys()), req(tx.objectStore('images').getAll()), req(tx.objectStore('recordings').getAllKeys()), req(tx.objectStore('recordings').getAll())]);
    await complete;
    const images = new Map(keys.map((key, i) => [key, blobs[i]]));
    const recordings = new Map(audioKeys.map((key, i) => [key, audioBlobs[i]]));
    if (!value) {
      const album = await this.save(createAlbum(), null);
      return { album, images, recordings };
    }
    const album = validateAlbum(value);
    for (const card of Object.values(album.cards)) if (card.imageId && !images.has(card.imageId)) throw Error('Не найдено фото карточки. Данные сохранены; восстановите резервную копию.');
    for (const card of Object.values(album.cards)) if (card.audioId && !validRecording(recordings.get(card.audioId))) throw Error('Не найдена озвучка карточки. Данные сохранены; восстановите резервную копию.');
    return { album, images, recordings };
  }
  async save(album, expectedRevision, images = new Map(), replaceImages = false, recordings = new Map(), replaceRecordings = false) {
    const clean = validateAlbum(album);
    for (const blob of recordings.values()) if (!validRecording(blob)) throw Error('Некорректная озвучка карточки');
    const tx = this.db.transaction(['album', 'images', 'recordings'], 'readwrite'), complete = done(tx);
    // Queue all reads/writes inside IDB callbacks to preserve Safari transaction lifetime.
    tx.objectStore('album').get('current').onsuccess = event => {
      const current = event.target.result;
      if ((expectedRevision === null && current) || (expectedRevision !== null && current?.revision !== expectedRevision)) { tx.abort(); return; }
      clean.revision = (current?.revision || 0) + 1;
      tx.objectStore('album').put(clean, 'current');
      const store = tx.objectStore('images');
      if (replaceImages) store.clear();
      for (const [id, blob] of images) store.put(blob, id);
      const needed = new Set(Object.values(clean.cards).map(c => c.imageId).filter(Boolean));
      store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { if (!needed.has(cursor.key)) cursor.delete(); cursor.continue(); }
      };
      const audio = tx.objectStore('recordings'), required = new Set(Object.values(clean.cards).map(c => c.audioId).filter(Boolean));
      if (replaceRecordings) audio.clear();
      for (const [id, blob] of recordings) audio.put(blob, id);
      for (const id of required) audio.get(id).onsuccess = e => { if (!validRecording(e.target.result)) tx.abort(); };
      audio.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { if (!required.has(cursor.key)) cursor.delete(); cursor.continue(); }
      };
    };
    await complete;
    return clean;
  }
}

const validRecording = blob => blob instanceof Blob && blob.type === 'audio/wav' && blob.size > 44 && blob.size <= MAX_AUDIO_BYTES;
const dataURL = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
export async function exportAlbum(album, images, recordings = new Map()) {
  const photos = {}, audio = {};
  for (const id of new Set(Object.values(album.cards).map(c => c.imageId).filter(Boolean))) {
    const blob = images.get(id);
    if (!blob) throw Error('Не найдено фото для резервной копии');
    photos[id] = await dataURL(blob);
  }
  for (const id of new Set(Object.values(album.cards).map(c => c.audioId).filter(Boolean))) {
    const blob = recordings.get(id);
    if (!validRecording(blob)) throw Error('Не найдена озвучка для резервной копии');
    audio[id] = await dataURL(blob);
  }
  const backup = new Blob([JSON.stringify({ format: 'pecsoteka', version: 2, album, images: photos, recordings: audio })], { type: 'application/json' });
  if (backup.size > 100 * 1024 * 1024) throw Error('Резервная копия больше 100 МБ. Уменьшите размер изображений и записей');
  return backup;
}
export async function importAlbum(file) {
  if (file.size > 100 * 1024 * 1024) throw Error('Резервная копия должна быть меньше 100 МБ');
  const data = JSON.parse(await file.text());
  if (data.format !== 'pecsoteka' || ![1, 2].includes(data.version)) throw Error('Выберите резервную копию PECSотеки');
  const album = validateAlbum(data.album), images = new Map(), recordings = new Map();
  for (const id of new Set(Object.values(album.cards).map(c => c.imageId).filter(Boolean))) {
    const uri = data.images?.[id];
    if (typeof uri !== 'string' || uri.length > 8 * 1024 * 1024 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(uri)) throw Error('В резервной копии некорректное изображение');
    const [header, body] = uri.split(','), raw = atob(body);
    const blob = new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], { type: header.slice(5, header.indexOf(';')) });
    const bitmap = await createImageBitmap(blob);
    const valid = bitmap.width <= 4096 && bitmap.height <= 4096;
    bitmap.close();
    if (!valid) throw Error('Изображение в копии слишком большое');
    images.set(id, blob);
  }
  for (const id of new Set(Object.values(album.cards).map(c => c.audioId).filter(Boolean))) {
    const uri = data.recordings?.[id];
    if (data.version < 2 || typeof uri !== 'string' || uri.length > 6 * 1024 * 1024 || !/^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(uri)) throw Error('В резервной копии некорректная озвучка');
    const raw = atob(uri.slice(uri.indexOf(',') + 1)), blob = new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], { type: 'audio/wav' });
    if (!validRecording(blob)) throw Error('В резервной копии слишком большая озвучка');
    await decodeRecording(blob); recordings.set(id, blob);
  }
  return { album, images, recordings };
}
