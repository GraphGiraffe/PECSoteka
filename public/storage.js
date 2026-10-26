import { createAlbum, validateAlbum } from './domain.js';

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || Error('Изменения не сохранены')); });
export class AlbumRepository {
  async open() {
    const r = indexedDB.open('pecsoteka', 1);
    r.onupgradeneeded = () => {
      // Schema 1. Further migrations belong in this versioned transaction.
      r.result.createObjectStore('album');
      r.result.createObjectStore('images');
    };
    this.db = await req(r);
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async load() {
    const tx = this.db.transaction(['album', 'images'], 'readonly'), complete = done(tx);
    const [value, keys, blobs] = await Promise.all([req(tx.objectStore('album').get('current')), req(tx.objectStore('images').getAllKeys()), req(tx.objectStore('images').getAll())]);
    await complete;
    const images = new Map(keys.map((key, i) => [key, blobs[i]]));
    if (!value) {
      const album = await this.save(createAlbum(), null);
      return { album, images };
    }
    const album = validateAlbum(value);
    for (const card of Object.values(album.cards)) if (card.imageId && !images.has(card.imageId)) throw Error('Не найдено фото карточки. Данные сохранены; восстановите резервную копию.');
    return { album, images };
  }
  async save(album, expectedRevision, images = new Map(), replaceImages = false) {
    const clean = validateAlbum(album);
    const tx = this.db.transaction(['album', 'images'], 'readwrite'), complete = done(tx);
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
    };
    await complete;
    return clean;
  }
}

export async function exportAlbum(album, images) {
  const photos = {};
  for (const id of new Set(Object.values(album.cards).map(c => c.imageId).filter(Boolean))) {
    const blob = images.get(id);
    if (!blob) throw Error('Не найдено фото для резервной копии');
    photos[id] = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  }
  return new Blob([JSON.stringify({ format: 'pecsoteka', version: 1, album, images: photos })], { type: 'application/json' });
}
export async function importAlbum(file) {
  if (file.size > 50 * 1024 * 1024) throw Error('Резервная копия должна быть меньше 50 МБ');
  const data = JSON.parse(await file.text());
  if (data.format !== 'pecsoteka' || data.version !== 1) throw Error('Выберите резервную копию PECSотеки');
  const album = validateAlbum(data.album), images = new Map();
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
  return { album, images };
}
