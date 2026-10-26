import { VERSION, uid, createAlbum, builtinIcons, numberToWords, randomInt, addToLine, homeOf, columnAt, moveCard, removeCard, phrase } from './domain.js';
import { AlbumRepository, exportAlbum, importAlbum } from './storage.js';
import { Feedback, Speech, readPhoto, cropPhoto } from './services.js';
import { DragController, enableWorkspacePan } from './drag.js';
import { PWAController } from './pwa.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  volume: '<path d="M11 4 5 9H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  edit: '<path d="m15 4 5 5M4 15 15 4a3.5 3.5 0 0 1 5 5L9 20l-6 1z"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
  check: '<path d="m5 12 4 4L19 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  cards: '<rect x="7" y="7" width="14" height="14" rx="3"/><path d="M16 7V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M11 15l3 3 4-5"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  camera: '<path d="M8 5 9 3h6l1 2h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2z"/><circle cx="12" cy="12" r="4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  left: '<path d="m14 5-7 7 7 7"/>', right: '<path d="m10 5 7 7-7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cards}</svg>`;
const btn = (action, title, name, extra = '') => `<button type="button" class="icon-btn" data-action="${action}" aria-label="${esc(title)}" title="${esc(title)}" ${extra}>${icon(name)}</button>`;
const checkbox = (name, label, checked) => `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${label}</label>`;
const range = (name, label, value, min, max, step = 1, suffix = '') => `<label class="field"><span>${label} <output>${value}${suffix}</output></span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" data-suffix="${suffix}"></label>`;

let repo, album, images = new Map(), imageURLs = new Map(), activeTab;
let editing = false, communication = [], buffer = [], busy = false, speechActive = false;
let feedback, speech, drag, pwa, lastActivity = Date.now();
let holdTimer, holdFrame, holdStart = 0, gateValue, gateFailures = 0, gateBlockedUntil = 0;
let modalCleanup = null, returnFocus = null, newlyAdded = '', restored = '';
let toastTimer;
const line = () => editing ? buffer : communication;
const tab = () => album.tabs.find(t => t.id === activeTab) || album.tabs[0];

function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('show');
  $('#live').textContent = message;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
function refreshImages() {
  for (const url of imageURLs.values()) URL.revokeObjectURL(url);
  imageURLs = new Map([...images].map(([id, blob]) => [id, URL.createObjectURL(blob)]));
}
function imageHTML(card) {
  const src = card.imageId ? imageURLs.get(card.imageId) : card.icon ? `./assets/cards/${card.icon}.svg` : '';
  return src ? `<span class="card-image"><img src="${esc(src)}" alt="" draggable="false" style="object-fit:${card.imageFit}"></span>` : '';
}
function cardHTML(card, attrs = '', selected = false) {
  const hasImage = card.imageId || card.icon;
  return `<button type="button" class="card ${selected ? 'selected' : ''} ${hasImage ? '' : 'text-only'} ${card.id === restored ? 'restored' : ''}" data-drag data-card-id="${card.id}" aria-label="${esc(card.title || card.speechText)}${selected ? (editing ? ', в буфере переноса' : ', в строке') : ''}" ${attrs}>${imageHTML(card)}${card.showLabel || !hasImage ? `<span class="card-title">${esc(card.title || card.speechText)}</span>` : ''}</button>`;
}
function renderTools() {
  $('#tools').innerHTML = editing
    ? `<span class="pill">Редактор · ${VERSION}</span>${btn('settings', 'Настройки альбома', 'settings')}${pwa?.installed ? '' : btn('install', 'Установить приложение', 'download')}<button class="button" data-action="finish">${icon('check')}<span>Готово</span></button>`
    : `<span class="mode-label">${icon('cards')}Мой альбом</span><button class="icon-btn hold-button" id="edit-gate" aria-label="Удерживайте 2,3 секунды для входа в редактор" title="Удерживайте 2,3 секунды для входа в редактор"><span>${icon('lock')}</span></button>`;
}
function renderBoard() {
  const t = tab(), selected = new Set((editing ? buffer : album.settings.copyCards ? [] : communication).map(i => i.cardId));
  $('#workspace').style.setProperty('--category-color', t.color);
  $('#album-heading').innerHTML = `<div class="heading-copy"><span class="category-dot" style="--tab-color:${t.color}" aria-hidden="true"></span><div><h1>${esc(t.title)}</h1><p>${editing ? 'Организуйте карточки. Изменения сохраняются автоматически.' : 'Выберите то, что хотите сказать'}</p></div></div>${editing ? btn('edit-tab', 'Изменить категорию', 'edit') : ''}`;
  $('#board').innerHTML = t.columns.map((col, n) => `<section class="column" data-column="${col.id}" data-tab="${t.id}" aria-label="Столбик ${n + 1}">
    ${editing ? `<div class="column-head"><span>Столбик ${n + 1}</span><div>${btn('column-left', 'Столбик влево', 'left', `data-column-id="${col.id}" ${n === 0 ? 'disabled' : ''}`)}${btn('delete-column', 'Удалить пустой столбик', 'close', `data-column-id="${col.id}" ${col.cardIds.length || t.columns.length === 1 ? 'disabled' : ''}`)}</div></div>` : ''}
    ${col.cardIds.map((id, index) => `<div class="card-wrap" data-slot="${index}" data-column="${col.id}">${cardHTML(album.cards[id], 'data-from="album"', selected.has(id))}${editing ? `<button class="icon-btn edit-card" data-action="edit-card" data-card-id="${id}" aria-label="Изменить карточку ${esc(album.cards[id].title)}">${icon('edit')}</button>` : ''}</div>`).join('')}
    ${editing ? `<button class="add-slot" data-action="slot" data-column-id="${col.id}" data-index="${col.cardIds.length}" title="${buffer.length ? 'Разместить первую карточку из буфера' : 'Добавить карточку'}">${icon('plus')}<span>${buffer.length ? 'Разместить' : 'Карточка'}</span></button>` : ''}
  </section>`).join('') + (editing && t.columns.length < 12 ? `<button class="add-column" data-action="add-column" aria-label="Добавить столбик">${icon('plus')}</button>` : '');
}
function renderTabs() {
  $('#tabs').innerHTML = album.tabs.map(t => `<button class="tab ${t.id === tab().id ? 'active' : ''}" style="--tab-color:${t.color}" data-action="tab" data-tab-id="${t.id}" aria-current="${t.id === tab().id ? 'page' : 'false'}">${esc(t.title)}</button>`).join('') + (editing && album.tabs.length < 40 ? btn('add-tab', 'Добавить категорию', 'plus') : '');
}
function renderLine() {
  const scroll = $('.line-items')?.scrollLeft || 0;
  const current = line();
  $('#message-panel').innerHTML = `<div class="line-top"><span class="line-label">${icon(editing ? 'cards' : 'volume')}${editing ? 'Буфер переноса' : 'Моё сообщение'}<span class="line-count">${current.length}</span></span><span class="line-note">${editing ? 'На другую вкладку → в нужное место' : 'Карточки складываются в слова'}</span></div>
    <div class="line-body"><div class="line-items" aria-label="${editing ? 'Карточки для переноса' : 'Карточки сообщения'}">${current.length ? current.map(item => `<div class="line-entry ${newlyAdded === item.instanceId ? 'just-added' : ''}" data-line-id="${item.instanceId}">${cardHTML(album.cards[item.cardId], `data-from="line" data-instance-id="${item.instanceId}"`)}<button class="remove-item" data-action="remove-line" data-instance-id="${item.instanceId}" aria-label="Вернуть ${esc(album.cards[item.cardId].title)}">${icon('close')}</button></div>`).join('') : `<div class="line-empty">${icon('cards')}<span>${editing ? 'Перенесите карточку сюда' : 'Перенесите сюда карточки'}<small>${editing ? 'Затем откройте другую вкладку и разместите её в столбике' : album.settings.tapToAdd ? 'Или нажмите на нужную карточку' : 'Перетащите карточку из альбома в эту строку'}</small></span></div>`}</div>
    <div class="line-actions">${editing ? '' : `<button class="button speak-button" data-action="speak" ${!current.length ? 'disabled' : ''}>${icon(speechActive ? 'stop' : 'volume')}<span>${speechActive ? 'Остановить' : 'Произнести'}</span></button>`}${(editing || album.settings.showClear) ? `<button class="icon-btn clear-button" data-action="clear-line" aria-label="${editing ? 'Отменить все переносы' : 'Очистить сообщение'}" ${!current.length ? 'disabled' : ''}>${icon('trash')}</button>` : ''}</div></div>`;
  $('.line-items').scrollLeft = scroll;
}
function render() {
  if (!album) return;
  const boardScroll = [$('#board').scrollLeft, $('#board').scrollTop], lineScroll = $('.line-items')?.scrollLeft || 0, tabsScroll = $('#tabs').scrollLeft;
  const focused = document.activeElement;
  const focusCard = focused?.dataset.cardId, focusAction = focused?.dataset.action, focusInstance = focused?.dataset.instanceId;
  document.documentElement.style.setProperty('--card-scale', album.settings.cardScale / 100);
  document.documentElement.style.setProperty('--line-scale', album.settings.lineCardScale / 100);
  document.documentElement.dataset.motion = album.settings.motion;
  $('#app').classList.toggle('editing', editing); $('#app').setAttribute('aria-busy', String(busy));
  feedback.settings = speech.settings = album.settings;
  renderTools(); renderBoard(); renderTabs(); renderLine();
  $('#board').scrollLeft = boardScroll[0]; $('#board').scrollTop = boardScroll[1]; $('#tabs').scrollLeft = tabsScroll;
  if ($('.line-items')) $('.line-items').scrollLeft = lineScroll;
  if (focusCard || focusAction) {
    const query = [focusAction ? `[data-action="${CSS.escape(focusAction)}"]` : '[data-drag]', focusCard ? `[data-card-id="${CSS.escape(focusCard)}"]` : '', focusInstance ? `[data-instance-id="${CSS.escape(focusInstance)}"]` : ''].join('');
    $(query)?.focus({ preventScroll: true });
  }
  newlyAdded = restored = '';
  queueMicrotask(maybeOfferUpdate);
}
async function mutate(change, newImages = new Map(), replaceImages = false) {
  if (!editing || busy) { if (busy) toast('Подождите, изменения сохраняются'); return false; }
  busy = true;
  try {
    const next = await change(structuredClone(album));
    album = await repo.save(next, album.revision, newImages, replaceImages);
    if (replaceImages) images = new Map(newImages); else for (const [id, blob] of newImages) images.set(id, blob);
    const used = new Set(Object.values(album.cards).map(c => c.imageId));
    for (const id of images.keys()) if (!used.has(id)) images.delete(id);
    refreshImages();
    communication = communication.filter(i => album.cards[i.cardId]).map(i => ({ ...i, source: homeOf(album, i.cardId) }));
    buffer = buffer.filter(i => album.cards[i.cardId]);
    if (!album.tabs.some(t => t.id === activeTab)) activeTab = album.tabs[0].id;
    lastActivity = Date.now(); return true;
  } catch (error) {
    toast(error.name === 'QuotaExceededError' ? 'Недостаточно памяти. Экспортируйте альбом и освободите место.' : `Не удалось сохранить. ${error.message}. Если альбом открыт в другой вкладке, перезагрузите эту.`);
    return false;
  } finally { busy = false; render(); }
}
function selectCard(cardId) {
  if (busy || !album.cards[cardId]) return false;
  const before = line(), next = addToLine(album, before, cardId, editing ? 'pendingMove' : 'communication');
  if (before === next) { toast(editing ? 'Карточка уже в буфере' : 'Карточка уже в сообщении'); return false; }
  if (next.length > 100) { toast('В строке может быть до 100 карточек'); return false; }
  if (editing) buffer = next; else communication = next;
  newlyAdded = next.at(-1).instanceId; render();
  $('.line-items').scrollLeft = $('.line-items').scrollWidth;
  if (!editing && album.settings.speakOnAdd) speak(album.cards[cardId].speechText);
  $('#live').textContent = `${album.cards[cardId].title}: ${editing ? 'в буфере переноса' : 'добавлено в сообщение'}`;
  return true;
}
function returnItem(instanceId) {
  const item = line().find(i => i.instanceId === instanceId);
  if (!item) return false;
  if (editing) buffer = buffer.filter(i => i.instanceId !== instanceId); else { speech.stop(); communication = communication.filter(i => i.instanceId !== instanceId); }
  restored = item.cardId; render(); $('#live').textContent = 'Карточка возвращена на своё место'; return true;
}
function speak(text) { try { speech.say(text); } catch (error) { toast(error.message); } }

let confirmationQueue = Promise.resolve();
function confirmAction(message) {
  const next = confirmationQueue.then(() => new Promise(resolve => {
    const dialog = $('#confirm-dialog'), previous = document.activeElement;
    dialog.innerHTML = `<div class="dialog-head"><h2 id="confirm-title">Подтверждение</h2><button type="button" class="icon-btn" data-confirm="no" aria-label="Закрыть">${icon('close')}</button></div><p class="lead">${esc(message)}</p><div class="dialog-actions"><button type="button" class="button ghost" data-confirm="no" autofocus>Отмена</button><button type="button" class="button" data-confirm="yes">Подтвердить</button></div>`;
    const finish = answer => {
      dialog.close(); dialog.innerHTML = ''; dialog.onclick = dialog.oncancel = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(answer);
    };
    dialog.onclick = e => { const button = e.target.closest('[data-confirm]'); if (button) finish(button.dataset.confirm === 'yes'); };
    dialog.oncancel = e => { e.preventDefault(); finish(false); };
    dialog.showModal();
  }));
  confirmationQueue = next.then(() => {});
  return next;
}

function openDialog(title, content, { cleanup = null, close = true } = {}) {
  if ($('#dialog').open) closeDialog(false);
  returnFocus = document.activeElement;
  $('#dialog').innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2>${close ? btn('close-dialog', 'Закрыть', 'close') : ''}</div>${content}`;
  modalCleanup = cleanup; $('#dialog').dataset.dirty = ''; $('#dialog').showModal();
  $('#dialog').querySelector('[autofocus]')?.focus();
}
function closeDialog(focus = true) {
  modalCleanup?.(); modalCleanup = null;
  $('#dialog').close(); $('#dialog').innerHTML = '';
  if (focus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  queueMicrotask(maybeOfferUpdate);
}
async function requestCloseDialog() {
  if (busy) return;
  if ($('#dialog').dataset.dirty && !await confirmAction('Закрыть форму без сохранения изменений?')) return;
  closeDialog();
}
$('#dialog').addEventListener('cancel', e => { e.preventDefault(); requestCloseDialog(); });

function resetHold() {
  clearTimeout(holdTimer); cancelAnimationFrame(holdFrame); holdStart = 0;
  $('#edit-gate')?.style.setProperty('--hold', 0);
}
function startHold(e) {
  if (editing || holdStart || $('#dialog').open) return;
  if (e.type === 'pointerdown' && (!e.isPrimary || e.button !== 0)) return;
  holdStart = performance.now();
  if (e.type === 'pointerdown') try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  const draw = () => { $('#edit-gate')?.style.setProperty('--hold', Math.min(1, (performance.now() - holdStart) / 2300)); holdFrame = requestAnimationFrame(draw); };
  draw(); holdTimer = setTimeout(() => { resetHold(); openGate(); }, 2300);
}
function openGate() {
  if (editing) return;
  if (Date.now() < gateBlockedUntil) { toast('Подождите несколько секунд и попробуйте снова'); return; }
  gateValue = album.settings.editGate === 'math' ? [randomInt(6, 19), randomInt(4, 15)] : randomInt(1000, 9999);
  const challenge = Array.isArray(gateValue) ? `${gateValue[0]} + ${gateValue[1]} = ?` : numberToWords(gateValue);
  openDialog('Вход для взрослого', `<p class="lead">${Array.isArray(gateValue) ? 'Решите пример, чтобы настроить альбом.' : 'Введите это число цифрами, чтобы настроить альбом.'}</p><div class="challenge" id="challenge">${challenge}</div><form id="gate-form"><label class="field">Ваш ответ<input class="gate-input" name="answer" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" autofocus required aria-describedby="gate-error"></label><p class="error" id="gate-error" aria-live="polite"></p><div class="dialog-actions spread"><button class="button ghost" type="button" data-action="new-challenge">Другое задание</button><button class="button" type="submit">Открыть редактор</button></div></form>`);
  $('#gate-form').onsubmit = e => {
    e.preventDefault(); if (Date.now() < gateBlockedUntil) { $('#gate-error').textContent = 'Немного подождите перед следующей попыткой.'; return; }
    const expected = Array.isArray(gateValue) ? gateValue[0] + gateValue[1] : gateValue;
    if ($('#gate-form').elements.answer.value.trim() !== String(expected)) {
      $('#gate-form').elements.answer.value = ''; gateFailures++;
      if (gateFailures >= 3) { gateBlockedUntil = Date.now() + 5000; gateFailures = 0; }
      $('#gate-error').textContent = 'Попробуйте ещё раз. Введите ответ цифрами.'; return;
    }
    gateFailures = 0; gateValue = null; closeDialog(); editing = true; buffer = []; lastActivity = Date.now(); speech.stop(); feedback.play('mode'); render();
    $('[data-action="finish"]')?.focus();
    pwa?.check().catch(() => {});
  };
}
async function finishEditing(automatic = false) {
  if (busy || $('#confirm-dialog').open) return;
  if ($('#dialog').open && $('#dialog').dataset.dirty && !await confirmAction('Завершить редактирование без сохранения открытой формы?')) { lastActivity = Date.now(); return; }
  const count = buffer.length; drag?.cancel(); buffer = []; editing = false; resetHold(); closeDialog(false); render();
  feedback.play('mode'); $('#edit-gate')?.focus({ preventScroll: true });
  toast(automatic ? 'Редактор закрыт после бездействия. Незавершённые переносы отменены.' : count ? 'Готово. Незавершённые переносы возвращены на место.' : 'Альбом сохранён. Можно общаться.');
}

function resolveDrop(item, x, y) {
  const panel = $('#message-panel'), panelRect = panel.getBoundingClientRect();
  if (x >= panelRect.left - 10 && x <= panelRect.right + 10 && y >= panelRect.top - 10 && y <= panelRect.bottom + 10) {
    const entry = document.elementFromPoint(x, y)?.closest('[data-line-id]');
    const index = entry ? line().findIndex(i => i.instanceId === entry.dataset.lineId) + (x > entry.getBoundingClientRect().left + entry.offsetWidth / 2 ? 1 : 0) : line().length;
    return { kind: 'line', index, rect: entry?.getBoundingClientRect() || panelRect };
  }
  const el = document.elementFromPoint(x, y), colEl = el?.closest('.column');
  if (!editing) return item.from === 'line' && el?.closest('#board') ? { kind: 'return', rect: $(`#board .card[data-card-id="${item.cardId}"]`)?.getBoundingClientRect() || $('#board').getBoundingClientRect() } : null;
  if (!colEl) return null;
  const col = tab().columns.find(c => c.id === colEl.dataset.column), wrap = el.closest('[data-slot]');
  let index = wrap ? Number(wrap.dataset.slot) + (y > wrap.getBoundingClientRect().top + wrap.offsetHeight / 2 ? 1 : 0) : col.cardIds.length;
  return { kind: 'album', tabId: tab().id, columnId: col.id, index, rect: wrap?.getBoundingClientRect() || colEl.getBoundingClientRect() };
}
function highlight(zone) {
  document.querySelectorAll('.drop-before,.drop-end,.drop-line').forEach(el => el.classList.remove('drop-before', 'drop-end', 'drop-line'));
  if (zone?.kind === 'line') $('#message-panel').classList.add('drop-line');
  if (zone?.kind === 'album') {
    const col = $(`.column[data-column="${zone.columnId}"]`);
    const before = col?.querySelector(`[data-slot="${zone.index}"]`);
    if (before) before.classList.add('drop-before'); else col?.querySelector('.add-slot')?.classList.add('drop-end');
  }
}
async function acceptDrop(item, zone) {
  if (busy) return false;
  if (zone.kind === 'line') {
    if (item.from === 'album') return selectCard(item.cardId);
    if (!album.settings.reorderLine && !editing) return false;
    const list = [...line()], from = list.findIndex(i => i.instanceId === item.instanceId);
    if (from < 0) return false;
    const [entry] = list.splice(from, 1); list.splice(zone.index - (zone.index > from ? 1 : 0), 0, entry);
    if (editing) buffer = list; else { speech.stop(); communication = list; } render(); return true;
  }
  if (zone.kind === 'return' && !editing) return returnItem(item.instanceId);
  if (zone.kind === 'album' && editing) {
    const success = await mutate(a => moveCard(a, item.cardId, zone));
    if (success) { buffer = buffer.filter(i => i.cardId !== item.cardId); restored = item.cardId; render(); $('#live').textContent = 'Новое место карточки сохранено'; }
    return success;
  }
  return false;
}

function openTabEditor(isNew = false) {
  if (!editing) return;
  const current = isNew ? { title: '', color: '#d9e7ad' } : tab();
  openDialog(isNew ? 'Новая категория' : 'Категория', `<form id="tab-form"><label class="field">Название<input name="title" value="${esc(current.title)}" maxlength="60" required autofocus></label><label class="field">Цвет<input name="color" type="color" value="${current.color}"></label>${!isNew ? `<div class="row"><button type="button" class="button ghost" data-action="tab-left" ${album.tabs.indexOf(current) === 0 ? 'disabled' : ''}>${icon('left')}Раньше</button><button type="button" class="button ghost" data-action="tab-right" ${album.tabs.indexOf(current) === album.tabs.length - 1 ? 'disabled' : ''}>Позже${icon('right')}</button></div><p class="note">Удалить можно только пустую категорию. Сначала перенесите её карточки через буфер.</p>` : ''}<div class="dialog-actions spread">${!isNew ? `<button type="button" class="button danger" data-action="delete-tab" ${current.columns.some(c => c.cardIds.length) || album.tabs.length === 1 ? 'disabled' : ''}>Удалить</button>` : ''}<button class="button" type="submit">Сохранить</button></div></form>`);
  $('#tab-form').onsubmit = async e => {
    e.preventDefault(); const form = e.currentTarget, title = form.elements.title.value.trim(), color = form.elements.color.value;
    if (!title) return;
    const newId = uid();
    const success = await mutate(a => {
      if (isNew) a.tabs.push({ id: newId, title, color, order: a.tabs.length, columns: [{ id: uid(), order: 0, cardIds: [] }] });
      else Object.assign(a.tabs.find(t => t.id === current.id), { title, color });
      return a;
    });
    if (success) { if (isNew) activeTab = newId; closeDialog(); render(); }
  };
}

async function openCardEditor(cardId, address) {
  if (!editing) return;
  const original = cardId ? album.cards[cardId] : { title: '', speechText: '', icon: '', showLabel: true, imageFit: 'contain' };
  let photo = null, selectedIcon = original.icon || '', removeImage = false, cropURL = '', photoGeneration = 0;
  const cleanup = () => { photoGeneration++; photo?.close(); if (cropURL) URL.revokeObjectURL(cropURL); };
  openDialog(cardId ? 'Карточка' : 'Новая карточка', `<form id="card-form">
    <div class="photo-preview" id="photo-preview">${imageHTML(original) || icon('photo')}</div>
    <div class="photo-buttons"><button type="button" class="button secondary" id="gallery">${icon('photo')}Галерея</button><button type="button" class="button secondary" id="camera">${icon('camera')}Камера</button><button type="button" class="button ghost" id="text-only">Только текст</button></div>
    <input type="file" accept="image/*" id="photo-file" hidden><input type="file" accept="image/*" capture="environment" id="camera-file" hidden>
    <div class="crop-controls" id="crop-controls" hidden>${range('zoom', 'Приближение', 1, 1, 3, .1)}${range('cropX', 'По горизонтали', 50, 0, 100)}${range('cropY', 'По вертикали', 50, 0, 100)}</div>
    <details style="margin-top:14px"><summary class="note">Выбрать стартовую пиктограмму</summary><div class="icon-picker">${builtinIcons.map(id => `<button type="button" class="icon-choice ${id === selectedIcon ? 'active' : ''}" data-icon="${id}" aria-label="Пиктограмма ${esc(createIconName(id))}"><img src="./assets/cards/${id}.svg" alt=""></button>`).join('')}</div></details>
    <label class="field">Подпись<input name="title" maxlength="160" value="${esc(original.title)}" required autofocus></label>
    <label class="field">Что произнести<input name="speechText" maxlength="500" value="${esc(original.speechText)}" placeholder="По умолчанию — подпись"><small>Например, подпись «Вода», а произнести «Я хочу воды».</small></label>
    ${checkbox('showLabel', 'Показывать подпись на карточке', original.showLabel !== false)}
    <p id="photo-error" class="error" aria-live="polite"></p>
    <div class="dialog-actions spread">${cardId ? `<div class="row"><button type="button" class="button danger" id="delete-card">Удалить</button><button type="button" class="button ghost" id="copy-card">Копия</button></div>` : ''}<button class="button" type="submit">Сохранить</button></div></form>`, { cleanup });
  const form = $('#card-form');
  const preview = async () => {
    if (!photo) return;
    const gen = ++photoGeneration;
    const blob = await cropPhoto(photo, Number(form.elements.zoom.value), Number(form.elements.cropX.value), Number(form.elements.cropY.value));
    if (gen !== photoGeneration || !$('#dialog').open) return;
    if (cropURL) URL.revokeObjectURL(cropURL); cropURL = URL.createObjectURL(blob);
    $('#photo-preview').innerHTML = `<img src="${cropURL}" alt="Предпросмотр кадрирования">`;
  };
  const choose = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const bitmap = await readPhoto(file);
      if (!form.isConnected) { bitmap.close(); return; }
      photo?.close(); photo = bitmap; selectedIcon = ''; removeImage = false;
      $('#crop-controls').hidden = false;
      form.elements.zoom.value = 1; form.elements.cropX.value = form.elements.cropY.value = 50;
      $('#photo-error').textContent = ''; await preview();
    } catch (error) { $('#photo-error').textContent = error.message; }
  };
  $('#gallery').onclick = () => $('#photo-file').click(); $('#camera').onclick = () => $('#camera-file').click();
  $('#photo-file').onchange = $('#camera-file').onchange = choose;
  for (const key of ['zoom', 'cropX', 'cropY']) form.elements[key].addEventListener('input', () => { preview().catch(error => { $('#photo-error').textContent = error.message; }); });
  $('#text-only').onclick = () => { photoGeneration++; photo?.close(); photo = null; selectedIcon = ''; removeImage = true; $('#crop-controls').hidden = true; $('#photo-preview').innerHTML = icon('photo'); };
  form.querySelectorAll('[data-icon]').forEach(button => { button.onclick = () => {
    photoGeneration++; photo?.close(); photo = null; selectedIcon = button.dataset.icon; removeImage = true;
    $('#crop-controls').hidden = true; $('#photo-preview').innerHTML = `<img src="./assets/cards/${selectedIcon}.svg" alt="">`;
    form.querySelectorAll('[data-icon]').forEach(b => b.classList.toggle('active', b === button));
  }; });
  form.onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    const title = form.elements.title.value.trim(), speechText = form.elements.speechText.value.trim() || title;
    if (!title || !speechText) return;
    const id = cardId || uid(), next = { ...original, id, title, speechText, showLabel: form.elements.showLabel.checked }, newImages = new Map();
    try {
      if (photo) { const imageId = uid(); newImages.set(imageId, await cropPhoto(photo, Number(form.elements.zoom.value), Number(form.elements.cropX.value), Number(form.elements.cropY.value))); next.imageId = imageId; next.imageFit = 'cover'; delete next.icon; }
      else if (removeImage || selectedIcon) { delete next.imageId; if (selectedIcon) next.icon = selectedIcon; else delete next.icon; next.imageFit = 'contain'; }
      const success = await mutate(a => { a.cards[id] = next; if (!cardId) { const col = columnAt(a, address); if (!col) throw Error('Столбик не найден'); col.cardIds.splice(Math.min(address.index, col.cardIds.length), 0, id); } return a; }, newImages);
      if (success) { closeDialog(); toast('Карточка сохранена'); }
    } catch (error) { $('#photo-error').textContent = error.message; }
  };
  if (cardId) {
    $('#delete-card').onclick = async () => {
      const selected = communication.some(i => i.cardId === cardId) || buffer.some(i => i.cardId === cardId);
      if (!await confirmAction(selected ? 'Карточка используется в сообщении или буфере. Удалить её из альбома и строки?' : `Удалить карточку «${original.title}»?`)) return;
      const success = await mutate(a => { removeCard(a, cardId); return a; }); if (success) closeDialog();
    };
    $('#copy-card').onclick = async () => {
      const id = uid(), source = homeOf(album, cardId);
      const success = await mutate(a => { a.cards[id] = { ...a.cards[cardId], id }; columnAt(a, source).cardIds.splice(source.index + 1, 0, id); return a; });
      if (success) { closeDialog(); toast('Копия карточки добавлена рядом'); }
    };
  }
}
function createIconName(id) {
  // This is a label lookup only, never another persisted album.
  const names = { want: 'Я хочу', help: 'Помоги', more: 'Ещё', stop: 'Стоп', yes: 'Да', no: 'Нет', pause: 'Перерыв', toilet: 'В туалет', water: 'Вода', apple: 'Яблоко', banana: 'Банан', bread: 'Хлеб', soup: 'Суп', milk: 'Молоко', cookie: 'Печенье', juice: 'Сок', play: 'Играть', book: 'Читать', walk: 'Гулять', sleep: 'Спать', draw: 'Рисовать', music: 'Музыка', wash: 'Мыть руки', eat: 'Есть', mom: 'Мама', dad: 'Папа', me: 'Я', home: 'Дом', park: 'Парк', school: 'Школа', happy: 'Радостно', sad: 'Грустно', hurt: 'Больно', hot: 'Жарко', cold: 'Холодно', tired: 'Устал' };
  return names[id] || id;
}

async function installApp() {
  try {
    if (!await pwa?.install()) toast('В меню браузера выберите «Установить приложение» или «На экран Домой». На iPad — через меню «Поделиться».');
  } catch { toast('Не удалось открыть установку. Попробуйте через меню браузера.'); }
}
function refreshPWAControls() {
  if (editing) renderTools();
  if ($('#install')) $('#install').hidden = !!pwa?.installed;
  if ($('#update-banner')) $('#update-banner').hidden = !pwa?.hasUpdate;
  if ($('#update-app')) $('#update-app').hidden = !!pwa?.hasUpdate;
  maybeOfferUpdate();
}
function maybeOfferUpdate() {
  if (!editing || busy || drag?.drag || $('#dialog').open || $('#confirm-dialog').open || !pwa?.shouldNotify) return;
  pwa.markNotified();
  openDialog('Доступно обновление', `<p class="lead">Можно установить новую версию приложения. Карточки, фотографии и сохранённые настройки останутся. Текущее сообщение и незавершённые переносы будут очищены.</p><div class="dialog-actions"><button class="button ghost" data-action="close-dialog">Позже</button><button class="button" data-action="apply-update" data-confirmed="yes">Обновить сейчас</button></div>`);
}
async function applyUpdate(confirmed = false) {
  if (!editing || busy || !pwa?.hasUpdate) return;
  if (!confirmed && (buffer.length || communication.length || $('#dialog').dataset.dirty) && !await confirmAction('Обновить приложение? Несохранённая форма, текущее сообщение и незавершённые переносы будут очищены. Альбом уже сохранён.')) return;
  if (pwa.apply()) { buffer = []; communication = []; toast('Обновляем приложение…'); }
}

function openSettings() {
  if (!editing) return;
  const s = album.settings;
  openDialog('Настройки альбома', `<aside class="update-banner" id="update-banner" ${pwa?.hasUpdate ? '' : 'hidden'}><strong>Доступно обновление</strong><p>Новая версия готова к установке. Карточки и сохранённые настройки останутся.</p><button type="button" class="button" data-action="apply-update">Обновить приложение</button></aside><form id="settings-form"><label class="field">Название альбома<input name="name" maxlength="160" value="${esc(album.name)}" required></label>
    <h3 class="section-title">Отображение</h3><div class="settings-grid">${range('cardScale', 'Карточки альбома', s.cardScale, 70, 150, 10, '%')}${range('lineCardScale', 'Карточки в строке', s.lineCardScale, 70, 150, 10, '%')}</div>
    <div class="row"><button type="button" class="button ghost" data-preset="80">Компактно</button><button type="button" class="button ghost" data-preset="100">Обычно</button><button type="button" class="button ghost" data-preset="130">Крупно</button></div>
    <label class="field">Анимации<select name="motion"><option value="full">Полные</option><option value="reduced">Сокращённые</option><option value="none">Без анимаций</option></select><small>Системное снижение движения учитывается автоматически.</small></label>
    <h3 class="section-title">Общение</h3>${checkbox('tapToAdd', 'Нажатие добавляет карточку в строку', s.tapToAdd)}${checkbox('copyCards', 'Оставлять карточку в альбоме, разрешать повторы', s.copyCards)}${checkbox('reorderLine', 'Разрешать менять порядок карточек в сообщении', s.reorderLine)}${checkbox('showClear', 'Показывать кнопку очистки сообщения', s.showClear)}
    <h3 class="section-title">Речь и звуки</h3>${checkbox('speakOnAdd', 'Произносить карточку при добавлении', s.speakOnAdd)}${checkbox('actionSounds', 'Мягкие звуки действий', s.actionSounds)}
    <label class="field">Русский голос<select name="voiceURI" id="voice-select"></select><small id="voice-note"></small></label>
    <div class="settings-grid">${range('rate', 'Скорость речи', s.rate, .5, 2, .1)}${range('pitch', 'Высота голоса', s.pitch, .5, 2, .1)}${range('speechVolume', 'Громкость речи', s.speechVolume, 0, 1, .05)}${range('soundVolume', 'Громкость сигналов', s.soundVolume, 0, 1, .05)}</div>
    <button type="button" class="button ghost" id="voice-test">${icon('volume')}Послушать голос</button>
    <h3 class="section-title">Вход для взрослого</h3><label class="field">Проверка после удержания<select name="editGate"><option value="spokenNumber">Четырёхзначное число словами</option><option value="math">Математический пример</option></select></label><label class="field">Закрывать редактор после бездействия<select name="autoLock"><option value="0">Не закрывать</option><option value="2">2 минуты</option><option value="5">5 минут</option><option value="10">10 минут</option><option value="30">30 минут</option><option value="60">60 минут</option></select></label>
    <h3 class="section-title">Данные альбома</h3><p class="lead">Делайте резервную копию: очистка данных браузера удалит альбом.</p>
    <div class="row"><button type="button" class="button secondary" id="export">${icon('download')}Экспорт</button><button type="button" class="button ghost" id="import">${icon('upload')}Импорт</button></div><input type="file" id="import-file" accept=".json,application/json" hidden>
    <p class="note" id="storage-info"></p><button type="button" class="button ghost" id="persist">Сохранять данные надёжнее</button>
    <h3 class="section-title">Приложение · ${VERSION}</h3><p class="lead">Цифровой коммуникативный альбом AAC. Стартовые пиктограммы — примеры: замените их понятными пользователю изображениями.</p>
    <div class="row"><button type="button" class="button ghost" id="install" ${pwa?.installed ? 'hidden' : ''}>На главный экран</button><button type="button" class="button ghost" id="update-app" ${pwa?.hasUpdate ? 'hidden' : ''}>Проверить обновление</button></div>
    <p class="note">Камера доступна при разрешении браузера. Вместо камеры может открыться выбор файла. Фото не отправляются на сервер.</p>
    <details><summary class="note">Удаление локальных данных</summary><p class="note">Удаляет все свои фото и карточки, возвращает стартовый альбом. Резервную копию сохраните заранее.</p><button type="button" class="button danger" id="reset-album">Удалить мои данные</button></details>
    <p class="error" id="settings-error" aria-live="polite"></p><div class="dialog-actions"><button type="button" class="button ghost" data-action="close-dialog">Отмена</button><button class="button" type="submit">Сохранить настройки</button></div></form>`);
  const form = $('#settings-form');
  for (const key of ['motion', 'editGate', 'autoLock']) form.elements[key].value = s[key];
  const voices = () => {
    if (!form.isConnected) return;
    const list = speech.voices(), previous = form.elements.voiceURI.value || s.voiceURI;
    form.elements.voiceURI.innerHTML = '<option value="">Русский голос по умолчанию</option>' + list.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)}${v.localService ? ' · локальный' : ' · сетевой'}</option>`).join('');
    form.elements.voiceURI.value = previous;
    if (form.elements.voiceURI.selectedIndex < 0) form.elements.voiceURI.value = '';
    $('#voice-note').textContent = list.length ? 'Сетевой голос используется только после вашего выбора.' : 'Русский голос пока не найден. Добавьте его в системных настройках или выберите другой доступный голос.';
  };
  voices(); window.speechSynthesis?.addEventListener('voiceschanged', voices);
  modalCleanup = () => { window.speechSynthesis?.removeEventListener('voiceschanged', voices); speech.stop(); speech.settings = album.settings; };
  const readSettings = () => {
    const next = { ...s };
    for (const key of ['cardScale', 'lineCardScale', 'rate', 'pitch', 'speechVolume', 'soundVolume', 'autoLock']) next[key] = Number(form.elements[key].value);
    for (const key of ['tapToAdd', 'copyCards', 'reorderLine', 'showClear', 'speakOnAdd', 'actionSounds']) next[key] = form.elements[key].checked;
    for (const key of ['motion', 'editGate', 'voiceURI']) next[key] = form.elements[key].value;
    return next;
  };
  form.onsubmit = async e => {
    e.preventDefault(); const nextSettings = readSettings(), name = form.elements.name.value.trim(); if (!name) return;
    const success = await mutate(a => { a.settings = nextSettings; a.name = name; return a; });
    if (success) { closeDialog(); toast('Настройки сохранены'); }
  };
  form.querySelectorAll('[data-preset]').forEach(b => { b.onclick = () => { for (const key of ['cardScale', 'lineCardScale']) { form.elements[key].value = b.dataset.preset; form.elements[key].dispatchEvent(new Event('input', { bubbles: true })); } }; });
  $('#voice-test').onclick = () => { speech.settings = readSettings(); speak('Я хочу общаться'); };
  $('#export').onclick = async () => {
    try {
      const blob = await exportAlbum(album, images), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `PECSoteka-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Резервная копия подготовлена');
    } catch (error) { $('#settings-error').textContent = error.message; }
  };
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const imported = await importAlbum(file);
      if (!form.isConnected || !editing) return;
      if (!await confirmAction('Заменить текущий альбом данными из резервной копии? Несохранённые настройки будут отменены.')) return;
      const success = await mutate(() => imported.album, imported.images, true);
      if (success) { communication = []; buffer = []; activeTab = album.tabs[0].id; closeDialog(); render(); toast('Альбом восстановлен. Проверьте способ входа для взрослого в настройках.'); }
    } catch (error) { if ($('#settings-error')) $('#settings-error').textContent = `Не удалось импортировать. ${error.message}`; }
  };
  navigator.storage?.estimate?.().then(info => { if ($('#storage-info')) $('#storage-info').textContent = `Занято примерно ${Math.max(.1, (info.usage || 0) / 1024 / 1024).toFixed(1)} МБ.`; }).catch(() => {});
  $('#persist').onclick = async () => { const result = await navigator.storage?.persist?.().catch(() => false); toast(result ? 'Браузер разрешил постоянное хранение. Резервная копия всё равно полезна.' : 'Постоянное хранение не разрешено. Сохраняйте резервные копии.'); };
  $('#install').onclick = installApp;
  $('#update-app').onclick = async () => {
    try {
      if (!await pwa?.check()) { toast('Проверка обновлений пока недоступна.'); return; }
      if (!pwa.hasUpdate) toast(pwa.registration.installing ? 'Обновление загружается. Сообщим, когда оно будет готово.' : 'Установлена актуальная версия.');
    } catch { toast('Не удалось проверить обновление. Проверьте подключение.'); }
  };
  $('#reset-album').onclick = async () => {
    if (!await confirmAction('Удалить все свои карточки и фотографии на этом устройстве? Вернётся стартовый альбом.')) return;
    const success = await mutate(() => createAlbum(), new Map(), true);
    if (success) { buffer = []; communication = []; activeTab = album.tabs[0].id; closeDialog(); render(); toast('Личные данные удалены. Открыт стартовый альбом.'); }
  };
}

document.addEventListener('input', e => {
  if (e.target.closest('#card-form,#tab-form,#settings-form')) $('#dialog').dataset.dirty = 'yes';
  if (e.target.matches('input[type=range]')) {
    const output = e.target.closest('label')?.querySelector('output'); if (output) output.textContent = e.target.value + (e.target.dataset.suffix || '');
  }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    const card = e.target.closest('[data-drag][data-from=album]');
    if (card && (editing || album.settings.tapToAdd || e.detail === 0)) { if (selectCard(card.dataset.cardId)) feedback.play('place'); }
    return;
  }
  if (el.disabled || busy) return;
  const action = el.dataset.action;
  try {
    if (action === 'tab') { activeTab = el.dataset.tabId; $('#board').scrollLeft = $('#board').scrollTop = 0; renderBoard(); renderTabs(); return; }
    if (action === 'speak') { if (speechActive) speech.stop(); else speak(phrase(album, communication)); return; }
    if (action === 'remove-line') { if (returnItem(el.dataset.instanceId)) feedback.play('return'); return; }
    if (action === 'clear-line') {
      if (line().length && await confirmAction(editing ? 'Вернуть все карточки из буфера на свои места?' : 'Очистить сообщение и вернуть карточки на место?')) {
        speech.stop(); if (editing) buffer = []; else communication = []; render(); feedback.play('return');
      } return;
    }
    if (action === 'close-dialog') { requestCloseDialog(); return; }
    if (action === 'new-challenge' && !editing) { openGate(); return; }
    if (!editing) return;
    if (action === 'finish') { finishEditing(); return; }
    if (action === 'settings') { openSettings(); return; }
    if (action === 'install') { await installApp(); return; }
    if (action === 'apply-update') { applyUpdate(el.dataset.confirmed === 'yes'); return; }
    if (action === 'add-tab') { openTabEditor(true); return; }
    if (action === 'edit-tab') { openTabEditor(); return; }
    if (action === 'edit-card') { await openCardEditor(el.dataset.cardId); return; }
    if (action === 'slot') {
      const address = { tabId: tab().id, columnId: el.dataset.columnId, index: Number(el.dataset.index) };
      if (buffer.length) await acceptDrop({ cardId: buffer[0].cardId, from: 'line' }, { kind: 'album', ...address }); else await openCardEditor(null, address);
      return;
    }
    if (action === 'add-column') { await mutate(a => { const t = a.tabs.find(t => t.id === activeTab); t.columns.push({ id: uid(), order: t.columns.length, cardIds: [] }); return a; }); return; }
    if (action === 'delete-column') {
      await mutate(a => { const t = a.tabs.find(t => t.id === activeTab), col = t.columns.find(c => c.id === el.dataset.columnId); if (col.cardIds.length || t.columns.length <= 1) throw Error('Сначала перенесите карточки из столбика'); t.columns = t.columns.filter(c => c !== col); return a; }); return;
    }
    if (action === 'column-left') {
      await mutate(a => { const t = a.tabs.find(t => t.id === activeTab), index = t.columns.findIndex(c => c.id === el.dataset.columnId); if (index > 0) [t.columns[index - 1], t.columns[index]] = [t.columns[index], t.columns[index - 1]]; return a; }); return;
    }
    if (action === 'tab-left' || action === 'tab-right') {
      const success = await mutate(a => { const index = a.tabs.findIndex(t => t.id === activeTab), next = index + (action === 'tab-left' ? -1 : 1); if (next >= 0 && next < a.tabs.length) [a.tabs[index], a.tabs[next]] = [a.tabs[next], a.tabs[index]]; return a; });
      if (success) openTabEditor(); return;
    }
    if (action === 'delete-tab') {
      if (!await confirmAction('Удалить пустую категорию?')) return;
      const success = await mutate(a => { const t = a.tabs.find(t => t.id === activeTab); if (a.tabs.length <= 1 || t.columns.some(c => c.cardIds.length)) throw Error('Нельзя удалить непустую или последнюю категорию'); a.tabs = a.tabs.filter(t => t.id !== activeTab); return a; });
      if (success) closeDialog(); return;
    }
  } catch (error) { toast(error.message); }
});
function isTextField(target) {
  const element = target instanceof Element ? target : target?.parentElement;
  const field = element?.closest('input,textarea');
  return !!field && (field.tagName === 'TEXTAREA' || ['text','number','password','search','email','url','tel'].includes(field.type));
}
document.addEventListener('selectstart', e => { if (!isTextField(e.target)) e.preventDefault(); });
document.addEventListener('contextmenu', e => { if (!isTextField(e.target)) e.preventDefault(); });
document.addEventListener('pointerdown', e => {
  lastActivity = Date.now();
  if (!e.isPrimary) { resetHold(); return; }
  if (e.target.closest('#edit-gate')) {
    e.preventDefault(); window.getSelection()?.removeAllRanges();
    startHold({ type: e.type, isPrimary: e.isPrimary, button: e.button, pointerId: e.pointerId, currentTarget: e.target.closest('#edit-gate') });
  }
  else if (holdStart) resetHold();
});
document.addEventListener('pointerup', resetHold);
document.addEventListener('pointercancel', resetHold);
document.addEventListener('keydown', e => {
  lastActivity = Date.now();
  if (e.target.closest('#edit-gate') && [' ', 'Enter'].includes(e.key)) { e.preventDefault(); if (!e.repeat) startHold(e); }
  if (e.key === 'Escape') { drag?.cancel(); resetHold(); }
});
document.addEventListener('keyup', e => { if ([' ', 'Enter'].includes(e.key)) resetHold(); });
document.addEventListener('focusout', e => { if (e.target.id === 'edit-gate') resetHold(); });
window.addEventListener('blur', resetHold);
document.addEventListener('visibilitychange', () => { if (document.hidden) { resetHold(); speech?.stop(); } });
window.addEventListener('pagehide', () => { drag?.cancel(); resetHold(); });
document.addEventListener('pointerup', () => setTimeout(maybeOfferUpdate, 350));
setInterval(() => { if (editing && !busy && album.settings.autoLock > 0 && Date.now() - lastActivity > album.settings.autoLock * 60000) finishEditing(true); }, 10000);

async function init() {
  try {
    repo = await new AlbumRepository().open();
    const loaded = await repo.load(); album = loaded.album; images = loaded.images;
    activeTab = album.tabs[0].id; refreshImages();
    feedback = new Feedback(album.settings);
    speech = new Speech(album.settings, active => { speechActive = active; if (album && !editing) renderLine(); });
    drag = new DragController({
      identify: el => { if (busy || $('#dialog').open || (el.classList.contains('selected') && el.dataset.from === 'album')) return null; return { cardId: el.dataset.cardId, from: el.dataset.from, instanceId: el.dataset.instanceId }; },
      resolve: resolveDrop, highlight, drop: acceptDrop, cue: name => feedback.play(name), motion: () => album.settings.motion
    });
    pwa = new PWAController(refreshPWAControls);
    enableWorkspacePan($('#workspace'), $('#board'));
    render();
    pwa.start().catch(() => { /* Adult settings retain the manual retry. */ });
  } catch (error) {
    $('#app').innerHTML = `<div class="fatal"><h1>Не удалось открыть альбом</h1><p>${esc(error.message)}</p><p>Проверьте разрешение браузера на хранение данных и перезагрузите страницу. Существующие данные не перезаписаны.</p><button class="button" onclick="location.reload()">Попробовать снова</button></div>`;
  }
}
init();
