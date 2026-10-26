export const VERSION = '0.1.3';
export const SCHEMA = 1;
export const uid = () => crypto.randomUUID();
export const defaults = Object.freeze({
  cardScale: 100, lineCardScale: 90, editGate: 'spokenNumber',
  tapToAdd: true, copyCards: false, reorderLine: true, showClear: true,
  speakOnAdd: false, actionSounds: true, soundVolume: 0.35,
  motion: 'full', voiceLang: 'ru-RU', voiceURI: '', rate: 0.9,
  pitch: 1, speechVolume: 1, autoLock: 10
});

const groups = [
  ['Просьбы', '#d9e7ad', [
    ['want', 'Я хочу'], ['help', 'Помоги'], ['more', 'Ещё'], ['stop', 'Стоп'],
    ['yes', 'Да'], ['no', 'Нет'], ['pause', 'Перерыв'], ['toilet', 'В туалет']
  ]],
  ['Еда и напитки', '#f1d49d', [
    ['water', 'Вода'], ['apple', 'Яблоко'], ['banana', 'Банан'], ['bread', 'Хлеб'],
    ['soup', 'Суп'], ['milk', 'Молоко'], ['cookie', 'Печенье'], ['juice', 'Сок']
  ]],
  ['Действия', '#cbdce8', [
    ['play', 'Играть'], ['book', 'Читать'], ['walk', 'Гулять'], ['sleep', 'Спать'],
    ['draw', 'Рисовать'], ['music', 'Музыка'], ['wash', 'Мыть руки'], ['eat', 'Есть']
  ]],
  ['Люди и места', '#e3d3e8', [
    ['mom', 'Мама'], ['dad', 'Папа'], ['me', 'Я'], ['home', 'Дом'],
    ['park', 'Парк'], ['school', 'Школа']
  ]],
  ['Чувства', '#efcbbf', [
    ['happy', 'Радостно'], ['sad', 'Грустно'], ['hurt', 'Больно'], ['hot', 'Жарко'],
    ['cold', 'Холодно'], ['tired', 'Устал']
  ]]
];
export const builtinIcons = groups.flatMap(([, , cards]) => cards.map(([icon]) => icon));

export function createAlbum() {
  const cards = {};
  const tabs = groups.map(([title, color, items], order) => {
    const columns = Array.from({ length: 5 }, (_, i) => ({ id: uid(), order: i, cardIds: [] }));
    items.forEach(([icon, name], i) => {
      const id = uid();
      cards[id] = { id, title: name, speechText: name, icon, showLabel: true, imageFit: 'contain' };
      columns[i % columns.length].cardIds.push(id);
    });
    return { id: uid(), title, color, order, columns };
  });
  return { id: uid(), name: 'Мой альбом', tabs, cards, settings: { ...defaults }, version: SCHEMA, revision: 0 };
}

export function homeOf(album, cardId) {
  for (const tab of album.tabs) for (const col of tab.columns) {
    const index = col.cardIds.indexOf(cardId);
    if (index !== -1) return { tabId: tab.id, columnId: col.id, index };
  }
  return null;
}
export function columnAt(album, address) {
  return album.tabs.find(t => t.id === address.tabId)?.columns.find(c => c.id === address.columnId);
}
export function lineItem(album, cardId, mode = 'communication') {
  const source = homeOf(album, cardId);
  if (!source || !album.cards[cardId]) throw Error('Карточка не найдена');
  return { instanceId: uid(), cardId, source: { ...source }, mode };
}
export function addToLine(album, line, cardId, mode = 'communication') {
  if ((!album.settings.copyCards || mode === 'pendingMove') && line.some(i => i.cardId === cardId)) return line;
  return [...line, lineItem(album, cardId, mode)];
}
// Temporary selections never remove IDs from the permanent album.
// A permanent move is prepared on a copy and committed by one storage transaction.
export function moveCard(album, cardId, destination) {
  const source = homeOf(album, cardId);
  const target = columnAt(album, destination);
  if (!source || !target || !Number.isInteger(destination.index) || destination.index < 0 || destination.index > target.cardIds.length) throw Error('Место переноса недоступно');
  const next = structuredClone(album);
  const from = columnAt(next, source), to = columnAt(next, destination);
  const same = source.columnId === destination.columnId;
  from.cardIds.splice(source.index, 1);
  const index = destination.index - (same && destination.index > source.index ? 1 : 0);
  to.cardIds.splice(index, 0, cardId);
  return next;
}
export function removeCard(album, cardId) {
  const home = homeOf(album, cardId);
  if (!home) throw Error('Карточка не найдена');
  columnAt(album, home).cardIds.splice(home.index, 1);
  delete album.cards[cardId];
}
export function phrase(album, line) {
  return line.map(i => album.cards[i.cardId]?.speechText.trim()).filter(Boolean).join(' ');
}

export function numberToWords(value) {
  if (!Number.isInteger(value) || value < 1000 || value > 9999) throw RangeError('Требуется четырёхзначное число');
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const k = Math.floor(value / 1000), tail = value % 100;
  return [k === 1 ? 'одна тысяча' : k === 2 ? 'две тысячи' : `${ones[k]} ${k < 5 ? 'тысячи' : 'тысяч'}`,
    hundreds[Math.floor(value % 1000 / 100)], tail >= 10 && tail < 20 ? teens[tail - 10] : tens[Math.floor(tail / 10)],
    tail >= 10 && tail < 20 ? '' : ones[tail % 10]].filter(Boolean).join(' ');
}
export function randomInt(min, max) {
  const range = max - min + 1, ceiling = Math.floor(2 ** 32 / range) * range;
  let n;
  do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= ceiling);
  return min + n % range;
}

const fail = () => { throw Error('Файл альбома повреждён или имеет неподдерживаемый формат'); };
const isId = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const text = (v, max = 160) => typeof v === 'string' && v.length <= max;
export function validateAlbum(input) {
  if (!input || input.version !== SCHEMA || !isId(input.id) || !text(input.name) || !input.tabs?.length || input.tabs.length > 40 || !input.cards || Array.isArray(input.cards)) fail();
  const cards = Object.entries(input.cards);
  if (cards.length > 2000) fail();
  const seen = new Set(), ids = new Set();
  const addId = id => { if (!isId(id) || ids.has(id)) fail(); ids.add(id); };
  input.tabs.forEach((tab, n) => {
    addId(tab.id);
    if (!text(tab.title, 60) || !tab.title.trim() || !/^#[0-9a-f]{6}$/i.test(tab.color) || !Array.isArray(tab.columns) || !tab.columns.length || tab.columns.length > 12) fail();
    tab.order = n;
    tab.columns.forEach((col, order) => {
      addId(col.id);
      if (!Array.isArray(col.cardIds) || col.cardIds.length > 500) fail();
      col.order = order;
      for (const id of col.cardIds) {
        if (!isId(id) || seen.has(id) || !Object.hasOwn(input.cards, id)) fail();
        seen.add(id);
      }
    });
  });
  for (const [id, card] of cards) {
    if (!isId(id) || card.id !== id || !seen.has(id) || !text(card.title) || !text(card.speechText, 500) || !card.speechText.trim()) fail();
    if (card.imageId && !isId(card.imageId)) fail();
    if (card.icon && !builtinIcons.includes(card.icon)) fail();
    if (card.showLabel !== undefined && typeof card.showLabel !== 'boolean') fail();
    if (card.imageFit !== undefined && !['cover', 'contain'].includes(card.imageFit)) fail();
  }
  const s = { ...defaults, ...input.settings };
  for (const [key, min, max] of [['cardScale', 70, 150], ['lineCardScale', 70, 150], ['soundVolume', 0, 1], ['rate', .5, 2], ['pitch', .5, 2], ['speechVolume', 0, 1], ['autoLock', 0, 60]]) {
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) fail();
  }
  for (const key of ['tapToAdd', 'copyCards', 'reorderLine', 'showClear', 'speakOnAdd', 'actionSounds']) if (typeof s[key] !== 'boolean') fail();
  if (!['spokenNumber', 'math'].includes(s.editGate) || !['full', 'reduced', 'none'].includes(s.motion) || !text(s.voiceURI, 500) || s.voiceLang !== 'ru-RU') fail();
  // Whitelist fields: exports never import executable values or external image URLs.
  return { id: input.id, name: input.name, version: SCHEMA, revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    tabs: input.tabs.map(t => ({ id: t.id, title: t.title, color: t.color, order: t.order, columns: t.columns.map(c => ({ id: c.id, order: c.order, cardIds: [...c.cardIds] })) })),
    cards: Object.fromEntries(cards.map(([id, c]) => [id, { id, title: c.title, speechText: c.speechText, ...(c.icon ? { icon: c.icon } : {}), ...(c.imageId ? { imageId: c.imageId } : {}), showLabel: c.showLabel !== false, imageFit: c.imageFit || 'contain' }])),
    settings: Object.fromEntries(Object.keys(defaults).map(k => [k, s[k]])) };
}
