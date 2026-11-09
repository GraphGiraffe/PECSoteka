import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { numberToWords } from '../public/domain.js';

const root = resolve(process.env.SITE_DIR || 'dist');
let swOverride = null;
let updatesOverride = null;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/PECSoteka/')) { res.writeHead(404).end(); return; }
    // Match directory-based static hosting (including Tailscale FileServer).
    if (pathname === '/PECSoteka/index.html') { res.writeHead(301, { Location: './' }).end(); return; }
    const file = resolve(root, pathname.slice('/PECSoteka/'.length) || 'index.html');
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const data = swOverride && pathname.endsWith('/sw.js') ? swOverride : updatesOverride && pathname.endsWith('/updates.json') ? updatesOverride : await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/PECSoteka/`;
await mkdir('artifacts', { recursive: true });
let executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome';
try { await access(executablePath); } catch { executablePath = chromium.executablePath(); }
let browser;
const results = [], errors = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log(`PASS ${name}`); };
const words = new Map(Array.from({ length: 9000 }, (_, i) => [numberToWords(i + 1000), i + 1000]));
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, acceptDownloads: true });
  await context.addInitScript(() => {
    window.__speechCalls = []; window.__cancels = 0; window.__oscillators = 0;
    // Simulate the complete platform boundary. A native utterance rejects a
    // plain JS voice, so mixing a real utterance with fake voices is invalid.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    window.__voices = [{ lang: 'ru-RU', voiceURI: 'test-ru', name: 'Test Russian', localService: true }];
    const synth = Object.assign(new EventTarget(), {
      getVoices: () => window.__voices,
      cancel: () => { window.__cancels++; }, speak: u => { window.__speechCalls.push(u.text); },
    });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    if (window.AudioContext) { const fn = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function(...args) { window.__oscillators++; return fn.apply(this, args); }; }
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push(`Unexpected native dialog: ${d.type()}`); d.dismiss(); });
  await page.goto(url); await page.locator('#board .card').first().waitFor();
  if (process.env.TEST_SCOPE === 'layout') {
    for (const [width, height] of [[1440, 900], [1180, 820], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
      await page.setViewportSize({ width, height });
      for (const scale of [70, 100, 150]) {
        await page.evaluate(scale => { document.documentElement.style.setProperty('--card-scale', scale / 100); document.documentElement.style.setProperty('--line-scale', scale / 100); }, scale);
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, tabsBottom: document.querySelector('#tabs').getBoundingClientRect().bottom, lineTop: document.querySelector('#message-panel').getBoundingClientRect().top, bottom: document.querySelector('#message-panel').getBoundingClientRect().bottom, height: innerHeight }));
        assert.ok(dimensions.scroll <= dimensions.viewport && dimensions.tabsBottom <= dimensions.lineTop && dimensions.bottom <= dimensions.height, `${width}px at ${scale}%: ${JSON.stringify(dimensions)}`);
        if (scale === 100) await page.screenshot({ path: `artifacts/layout-${width}.png`, fullPage: true });
      }
      console.log(`PASS layout ${width}×${height}, 70/100/150%`);
    }
    await browser.close(); server.close(); process.exit(0);
  }
  const dbRead = () => page.evaluate(async () => { const { AlbumRepository } = await import('./storage.js'); const r = await new AlbumRepository().open(); const value = await r.load(); r.db.close(); return value.album; });
  const card = title => page.locator('#board .card').filter({ has: page.locator('.card-title', { hasText: new RegExp(`^${title}$`) }) }).first();
  const assertCount = async (selector, n) => assert.equal(await page.locator(selector).count(), n);
  const waitForCount = async (selector, n) => { await page.waitForFunction(([s, count]) => document.querySelectorAll(s).length === count, [selector, n]); };
  const gate = async () => {
    const rect = await page.locator('#edit-gate').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.waitForTimeout(2400); await page.mouse.up();
    await page.locator('#gate-form').waitFor();
    const challenge = (await page.locator('#challenge').textContent()).trim();
    const value = words.get(challenge); assert.ok(value, 'gate contains a correct Russian four-digit challenge');
    await page.locator('[name=answer]').fill('0'); await page.locator('#gate-form button[type=submit]').click(); assert.ok(await page.locator('#gate-error').textContent());
    await page.locator('[name=answer]').fill(String(value)); await page.locator('#gate-form button[type=submit]').click();
    await page.locator('.app.editing').waitFor();
  };
  const touch = await context.newCDPSession(page);
  await check('Chromium computes a distinct PWA identity and keeps the album navigation scope', async () => {
    const { manifest, errors: manifestErrors } = await touch.send('Page.getAppManifest');
    assert.equal(manifestErrors.filter(error => error.critical).length, 0);
    assert.equal(manifest.id, new URL('/pecsoteka', url).href);
    assert.equal(manifest.startUrl, url);
    assert.equal(manifest.scope, url);
  });
  const dragTo = async (source, target, offset = .5) => {
    const from = await source.boundingBox(), to = typeof target === 'object' && typeof target.x === 'number' ? target : await target.boundingBox();
    assert.ok(from && to, 'drag endpoints exist');
    const start = { x: from.x + from.width * .45, y: from.y + from.height * .6 }, end = { x: to.x + to.width / 2, y: to.y + to.height * offset };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let i = 1; i <= 12; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 12, y: start.y + (end.y - start.y) * i / 12, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.locator('.drag-ghost').waitFor({ state: 'detached' });
  };
  const initial = await dbRead();
  await page.screenshot({ path: 'artifacts/tablet-initial.png', fullPage: true });
  await check('UI text rejects selection while text inputs retain editing and touch gate works', async () => {
    for (const selector of ['.brand','.mode-label','.heading-copy','.tab','.card-title','#edit-gate']) {
      assert.equal(await page.locator(selector).first().evaluate(el => getComputedStyle(el).userSelect), 'none', selector);
    }
    assert.equal(await page.locator('.brand').evaluate(el => el.dispatchEvent(new Event('selectstart', { bubbles:true,cancelable:true }))), false);
    assert.equal(await page.locator('#edit-gate').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true,cancelable:true }))), false);
    const rect = await page.locator('#edit-gate').boundingBox(), point = { x:rect.x+rect.width/2,y:rect.y+rect.height/2,id:1 };
    await touch.send('Input.dispatchTouchEvent', { type:'touchStart',touchPoints:[point] });
    await page.waitForTimeout(2400);
    await touch.send('Input.dispatchTouchEvent', { type:'touchEnd',touchPoints:[] });
    await page.locator('#gate-form').waitFor();
    const field=page.locator('#gate-form [name=answer]');
    assert.equal(await field.evaluate(el => getComputedStyle(el).userSelect), 'text');
    await field.fill('1234');
    assert.equal(await field.evaluate(el => { el.select(); return el.selectionEnd-el.selectionStart; }), 4);
    assert.equal(await field.evaluate(el => el.dispatchEvent(new Event('selectstart', { bubbles:true,cancelable:true }))), true);
    assert.equal(await field.evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true,cancelable:true }))), true);
    assert.equal(await page.locator('#dialog-title').evaluate(el=>getComputedStyle(el).userSelect),'none');
    await page.getByRole('button',{ name:'Закрыть',exact:true }).click();
  });
  await check('A12 short press never opens editor', async () => { await page.locator('#edit-gate').click(); await assertCount('#gate-form', 0); await assertCount('.app.editing', 0); });
  await check('A01 A04 touch drag adds to line without changing album', async () => {
    await dragTo(card('Я хочу'), page.locator('#message-panel')); await waitForCount('.line-entry', 1);
    assert.deepEqual(await dbRead(), initial); assert.ok((await card('Я хочу').getAttribute('class')).includes('selected'));
    await dragTo(card('Помоги'), card('Ещё')); assert.deepEqual(await dbRead(), initial); await assertCount('.line-entry', 1);
  });
  await check('A02 A08 tab switch preserves message; return restores exact source', async () => {
    await page.getByRole('button', { name: 'Еда и напитки', exact: true }).click(); await assertCount('.line-entry', 1);
    await page.getByRole('button', { name: 'Вернуть Я хочу', exact: true }).click();
    await page.getByRole('button', { name: 'Просьбы', exact: true }).click();
    assert.deepEqual(await dbRead(), initial); assert.ok(!(await card('Я хочу').getAttribute('class')).includes('selected'));
  });
  await check('A03 invalid touch drop returns without losing card', async () => {
    await dragTo(card('Я хочу'), { x: 5, y: 2, width: 20, height: 10 }); await assertCount('.line-entry', 0); assert.deepEqual(await dbRead(), initial);
  });
  await check('A13 A14 adult hold and Russian number gate', gate);
  await check('A05 multiple buffered moves insert and shift; cancellation restores other card', async () => {
    await dragTo(card('Я хочу'), page.locator('#message-panel'));
    await card('Помоги').click(); await waitForCount('.line-entry', 2);
    await page.getByRole('button', { name: 'Еда и напитки', exact: true }).click();
    await dragTo(page.locator('.line-entry').first().locator('.card'), card('Вода'), .2);
    await waitForCount('.line-entry', 1);
    const a = await dbRead(), water = a.tabs[1].columns[0].cardIds;
    assert.equal(a.cards[water[0]].title, 'Я хочу'); assert.equal(a.cards[water[1]].title, 'Вода');
    await page.getByRole('button', { name: 'Вернуть Помоги', exact: true }).click();
    await page.getByRole('button', { name: 'Просьбы', exact: true }).click(); assert.ok(!(await card('Помоги').getAttribute('class')).includes('selected'));
  });
  await check('A06 A07 exiting editor and reloading cancel pending moves', async () => {
    await card('Помоги').click(); await page.getByRole('button', { name: 'Готово', exact: true }).click(); await assertCount('.line-entry', 0);
    await gate(); await card('Помоги').click(); await page.reload(); await page.locator('#board .card').first().waitFor();
    await assertCount('.app.editing', 0); await assertCount('.line-entry', 0); assert.ok(await card('Помоги').isVisible());
    await page.getByRole('button', { name: 'Еда и напитки', exact: true }).click(); assert.ok(await card('Я хочу').isVisible());
  });
  await gate();
  await check('A15 photo crop, label and separate speech text persist', async () => {
    await page.locator('[data-action=edit-card]').first().click();
    await page.locator('#photo-file').setInputFiles('public/assets/icon-512.png'); await page.locator('#crop-controls').waitFor({ state: 'visible' });
    await page.locator('#card-form [name=title]').fill('Мой стакан'); await page.locator('#card-form [name=speechText]').fill('воды');
    await page.locator('#card-form button[type=submit]').click(); await page.locator('#card-form').waitFor({ state: 'detached' });
    const a = await dbRead(), custom = Object.values(a.cards).find(c => c.title === 'Мой стакан'); assert.ok(custom.imageId); assert.equal(custom.speechText, 'воды');
  });
  await check('A10 A11 A18 independent audio, scale and motion settings persist', async () => {
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click();
    await page.locator('[name=actionSounds]').uncheck(); await page.locator('[name=cardScale]').fill('130'); await page.locator('[name=motion]').selectOption('none');
    await page.locator('#settings-form button[type=submit]').click(); await page.locator('#settings-form').waitFor({ state: 'detached' });
    const a = await dbRead(); assert.equal(a.settings.cardScale, 130); assert.equal(a.settings.actionSounds, false); assert.equal(a.settings.motion, 'none');
    await page.getByRole('button', { name: 'Готово', exact: true }).click(); await page.reload(); await page.locator('#board .card').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'none');
  });
  await check('A09 A20 speech order and cancel-before-speak policy (API simulation)', async () => {
    await card('Помоги').click(); await page.getByRole('button', { name: 'Еда и напитки', exact: true }).click(); await card('Мой стакан').click();
    await page.getByRole('button', { name: 'Произнести', exact: true }).click(); await page.getByRole('button', { name: 'Произнести', exact: true }).click();
    const value = await page.evaluate(() => ({ calls: window.__speechCalls, cancels: window.__cancels, signals: window.__oscillators }));
    assert.deepEqual(value.calls.slice(-2), ['Помоги воды', 'Помоги воды']); assert.ok(value.cancels >= 2); assert.equal(value.signals, 0);
  });
  await check('A19 orientation changes keep current message', async () => {
    await page.setViewportSize({ width: 820, height: 1180 }); await assertCount('.line-entry', 2); await page.setViewportSize({ width: 1180, height: 820 });
  });
  await check('First speech request waits for late voice discovery without another click or false toast', async () => {
    const previous = await page.evaluate(() => {
      const count=window.__speechCalls.length, voices=window.__voices;
      window.__voices=[];
      setTimeout(()=>{window.__voices=voices;window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));},180);
      return count;
    });
    await page.getByRole('button',{name:'Произнести',exact:true}).click();
    await page.waitForFunction(n=>window.__speechCalls.length===n+1,previous);
    assert.equal((await page.evaluate(()=>window.__speechCalls)).at(-1),'Помоги воды');
    assert.ok(!/голос.*(не найден|недоступен)/i.test(await page.locator('#toast').textContent()));
  });
  await check('Pointer cancellation returns card without committing a move', async () => {
    const rect = await card('Вода').boundingBox();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 30, y: rect.y + 30, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + 50, y: rect.y + 60, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await assertCount('.drag-ghost', 0); await assertCount('.line-entry', 2);
  });
  await gate();
  await check('A17 single-file backup restores photo, columns and settings', async () => {
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click();
    const download = page.waitForEvent('download'); await page.locator('#export').click(); const d = await download; const file = 'artifacts/backup.json'; await d.saveAs(file);
    const before = await dbRead(); await page.getByText('Удаление локальных данных', { exact: true }).click(); await page.locator('#reset-album').click(); await page.locator('#confirm-dialog [data-confirm=yes]').click(); await page.locator('#settings-form').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click(); await page.locator('#import-file').setInputFiles(file); await page.locator('#confirm-dialog [data-confirm=yes]').click(); await page.locator('#settings-form').waitFor({ state: 'detached' });
    const after = await dbRead(); delete before.revision; delete after.revision; assert.deepEqual(after, before);
  });
  let recordedCard, recordedBytes;
  const closeDirtyCard = async () => {
    await page.locator('#dialog [data-action=close-dialog]').first().click();
    if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-dialog [data-confirm=yes]').click();
    await page.locator('#card-form').waitFor({ state: 'detached' });
  };
  await check('Real microphone capture normalizes WAV, previews, and saves only on card submit', async () => {
    const initial = await dbRead(); recordedCard = initial.cards[initial.tabs[0].columns[0].cardIds[0]];
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__realMicrophone = original;
      navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await original(...args); window.__recordingStream = stream; return stream; };
    });
    await page.locator(`[data-action=edit-card][data-card-id="${recordedCard.id}"]`).click();
    await page.locator('#record-start').click(); await page.locator('#record-stop').waitFor({ state: 'visible' });
    await page.waitForTimeout(750); await page.locator('#record-stop').click();
    await page.waitForFunction(() => document.querySelector('#recording-status').textContent.includes('Запись готова') && !document.querySelector('#card-form [type=submit]').disabled);
    assert.equal((await dbRead()).cards[recordedCard.id].audioId, undefined);
    assert.equal(await page.evaluate(() => window.__recordingStream.getTracks().every(t => t.readyState === 'ended')), true);
    await page.locator('#audio-preview').click(); await page.waitForFunction(() => document.querySelector('#audio-preview').textContent === 'Прослушать');
    await page.locator('#card-form [type=submit]').click(); await page.locator('#card-form').waitFor({ state: 'detached' });
    const value = await page.evaluate(async id => {
      const { AlbumRepository } = await import('./storage.js'), r = await new AlbumRepository().open(), data = await r.load();
      const blob = data.recordings.get(data.album.cards[id].audioId); const bytes = [...new Uint8Array(await blob.arrayBuffer())]; r.db.close();
      return { type: blob.type, bytes };
    }, recordedCard.id);
    assert.equal(value.type, 'audio/wav'); assert.equal(Buffer.from(value.bytes.slice(0, 4)).toString(), 'RIFF');
    recordedBytes = Buffer.from(value.bytes); assert.ok(recordedBytes.length > 1000);
  });
  await check('Denied microphone, invalid upload and canceled retake preserve the saved recording', async () => {
    const before = await dbRead();
    await page.locator(`[data-action=edit-card][data-card-id="${recordedCard.id}"]`).click();
    await page.evaluate(() => { window.__workingMicrophone = navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.locator('#record-start').click(); await page.waitForFunction(() => document.querySelector('#audio-error').textContent.includes('не разрешён'));
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__workingMicrophone; });
    await page.locator('#audio-file').setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('not audio')});
    await page.waitForFunction(() => document.querySelector('#audio-error').textContent.includes('Не удалось прочитать'));
    await page.locator('#record-start').click(); await page.locator('#record-stop').waitFor({state:'visible'});
    await page.locator('#record-cancel').click();
    assert.equal(await page.evaluate(() => window.__recordingStream.getTracks().every(t => t.readyState === 'ended')),true);
    await closeDirtyCard(); assert.deepEqual(await dbRead(),before);
  });
  await check('Retake comparison can keep the old take or commit only the selected new take', async () => {
    const old = (await dbRead()).cards[recordedCard.id].audioId;
    await page.locator(`[data-action=edit-card][data-card-id="${recordedCard.id}"]`).click();
    await page.locator('#audio-file').setInputFiles({name:'voice.wav',mimeType:'audio/wav',buffer:recordedBytes});
    await page.locator('#recording-choice').waitFor({state:'visible'});
    await page.locator('#audio-old-preview').click(); await page.waitForFunction(() => document.querySelector('#audio-old-preview').textContent === 'Прослушать старую');
    await page.locator('#audio-new-preview').click(); await page.waitForFunction(() => document.querySelector('#audio-new-preview').textContent === 'Прослушать новую');
    await page.locator('[name=recordingChoice][value=old]').check();
    await page.locator('#card-form [type=submit]').click(); await page.locator('#card-form').waitFor({state:'detached'});
    assert.equal((await dbRead()).cards[recordedCard.id].audioId,old);
    await page.locator(`[data-action=edit-card][data-card-id="${recordedCard.id}"]`).click();
    await page.locator('#audio-file').setInputFiles({name:'replacement.wav',mimeType:'audio/wav',buffer:recordedBytes});
    await page.locator('#recording-choice').waitFor({state:'visible'});
    await page.locator('[name=recordingChoice][value=new]').check();
    await page.screenshot({path:'artifacts/recording-editor.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('#dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await page.screenshot({path:'artifacts/recording-editor-mobile.png',fullPage:true});
    await page.setViewportSize({width:1180,height:820});
    await page.locator('#card-form [type=submit]').click(); await page.locator('#card-form').waitFor({state:'detached'});
    assert.notEqual((await dbRead()).cards[recordedCard.id].audioId,old);
    assert.equal(await page.evaluate(async oldId=>{const {AlbumRepository}=await import('./storage.js'),r=await new AlbumRepository().open(),s=await r.load();r.db.close();return !s.recordings.has(oldId)&&s.recordings.size===1;},old),true);
  });
  await check('Recording-only messages play sequentially without any TTS voice and stop cleanly', async () => {
    await page.getByRole('button',{name:'Настройки альбома',exact:true}).click();
    await page.locator('[name=speechMode]').selectOption('recordings'); await page.locator('[name=copyCards]').check();
    await page.locator('#settings-form [type=submit]').click(); await page.locator('#settings-form').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Готово',exact:true}).click();
    await page.evaluate(()=>{
      window.__savedVoices=window.__voices;window.__voices=[];window.__clipEvents=[];
      const original=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource=function(...args){const source=original.apply(this,args),start=source.start;source.start=function(...a){window.__clipEvents.push('start');return start.apply(this,a);};source.addEventListener('ended',()=>window.__clipEvents.push('end'));return source;};
    });
    await card(recordedCard.title).click();await card(recordedCard.title).click();
    const before=await page.evaluate(()=>window.__speechCalls.length);
    await page.getByRole('button',{name:'Произнести',exact:true}).click();
    await page.waitForFunction(()=>window.__clipEvents.length===4);
    assert.deepEqual(await page.evaluate(()=>window.__clipEvents),['start','end','start','end']);
    assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);
    await page.evaluate(()=>{window.__clipEvents=[];});
    await page.getByRole('button',{name:'Произнести',exact:true}).click();await page.waitForFunction(()=>window.__clipEvents.includes('start'));
    await page.getByRole('button',{name:'Остановить',exact:true}).click();await page.waitForTimeout(1000);
    assert.equal((await page.evaluate(()=>window.__clipEvents)).filter(e=>e==='start').length,1);
    const a=await dbRead(),missing=a.cards[a.tabs[0].columns.flatMap(c=>c.cardIds).find(id=>id!==recordedCard.id)];
    await card(missing.title).click(); await page.getByRole('button',{name:'Произнести',exact:true}).click();
    assert.ok((await page.locator('#toast').textContent()).includes('Нет записи'));
    assert.equal(await page.evaluate(()=>window.__speechCalls.length),before);
    await page.locator('[data-action=clear-line]').click();await page.locator('#confirm-dialog [data-confirm=yes]').click();
    await page.evaluate(()=>{window.__voices=window.__savedVoices;});
  });
  await check('Mixed recording and TTS segments wait for completion in message order',async()=>{
    await gate();await page.getByRole('button',{name:'Настройки альбома',exact:true}).click();
    await page.locator('[name=speechMode]').selectOption('preferRecordings');
    await page.locator('#settings-form [type=submit]').click();await page.locator('#settings-form').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Готово',exact:true}).click();
    await page.evaluate(()=>{window.__clipEvents=[];const original=speechSynthesis.speak;speechSynthesis.speak=u=>{window.__clipEvents.push('tts-start');original(u);u.onstart?.();setTimeout(()=>{window.__clipEvents.push('tts-end');u.onend?.();},30);};});
    const a=await dbRead(),other=a.cards[a.tabs[0].columns.flatMap(c=>c.cardIds).find(id=>id!==recordedCard.id)];
    await card(recordedCard.title).click();await card(other.title).click();await card(recordedCard.title).click();
    await page.getByRole('button',{name:'Произнести',exact:true}).click();await page.waitForFunction(()=>window.__clipEvents.length===6);
    assert.deepEqual(await page.evaluate(()=>window.__clipEvents),['start','end','tts-start','tts-end','start','end']);
    await gate();
  });
  await check('Recorded clips and chosen take survive backup, reset, import and reload',async()=>{
    await page.getByRole('button',{name:'Настройки альбома',exact:true}).click();
    const promise=page.waitForEvent('download');await page.locator('#export').click();const download=await promise;await download.saveAs('artifacts/recordings-backup.json');
    const before=await dbRead(),backup=JSON.parse(await readFile('artifacts/recordings-backup.json','utf8'));assert.equal(backup.version,2);assert.equal(Object.keys(backup.recordings).length,1);
    await page.getByText('Удаление локальных данных',{exact:true}).click();await page.locator('#reset-album').click();await page.locator('#confirm-dialog [data-confirm=yes]').click();await page.locator('#settings-form').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Настройки альбома',exact:true}).click();await page.locator('#import-file').setInputFiles('artifacts/recordings-backup.json');await page.locator('#confirm-dialog [data-confirm=yes]').click();await page.locator('#settings-form').waitFor({state:'detached'});
    const after=await dbRead();delete before.revision;delete after.revision;assert.deepEqual(after,before);
    await page.reload();await page.locator('#board .card').first().waitFor();await gate();
    assert.equal(await page.evaluate(async()=>{const {AlbumRepository}=await import('./storage.js'),r=await new AlbumRepository().open(),d=await r.load();r.db.close();return d.recordings.size;}),1);
  });
  await check('Audio garbage collection preserves shared clips and failed writes are atomic',async()=>{
    const isolated=await browser.newContext(),q=await isolated.newPage();
    try{await q.goto(url);await q.locator('#board .card').first().waitFor();
      assert.equal(await q.evaluate(async bytes=>{
        const {AlbumRepository}=await import('./storage.js'),{removeCard}=await import('./domain.js'),r=await new AlbumRepository().open();
        let s=await r.load(),a=s.album;const id=Object.keys(a.cards)[0];a.cards[id].audioId='shared-recording';
        a.cards.copy={...a.cards[id],id:'copy'};a.tabs[0].columns[0].cardIds.push('copy');
        a=await r.save(a,a.revision,new Map(),false,new Map([['shared-recording',new Blob([new Uint8Array(bytes)],{type:'audio/wav'})]]));
        removeCard(a,id);a=await r.save(a,a.revision);if(!(await r.load()).recordings.has('shared-recording'))return false;
        removeCard(a,'copy');a=await r.save(a,a.revision);if((await r.load()).recordings.size!==0)return false;
        const bad=structuredClone(a);bad.cards[Object.keys(bad.cards)[0]].audioId='missing';let failed=false;
        try{await r.save(bad,a.revision);}catch{failed=true;}
        const after=await r.load();r.db.close();return failed&&JSON.stringify(after.album)===JSON.stringify(a);
      },[...recordedBytes]),true);
    }finally{await isolated.close();}
  });
  await check('An existing schema-1 IndexedDB album and photo migrate without loss',async()=>{
    const isolated=await browser.newContext(),q=await isolated.newPage();
    try{
      await q.route(url+'legacy-shell',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Migration</title>'}));await q.goto(url+'legacy-shell');
      const bytes=[...await readFile('public/assets/icon-512.png')];
      const original=await q.evaluate(async bytes=>{
        const {createAlbum}=await import('./domain.js');const a=createAlbum();a.version=1;delete a.settings.speechMode;a.name='Старый альбом';a.cards[Object.keys(a.cards)[0]].imageId='legacy-photo';
        const request=indexedDB.open('pecsoteka',1);request.onupgradeneeded=()=>{request.result.createObjectStore('album');request.result.createObjectStore('images');};
        const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        const tx=db.transaction(['album','images'],'readwrite');tx.objectStore('album').put(a,'current');tx.objectStore('images').put(new Blob([new Uint8Array(bytes)],{type:'image/png'}),'legacy-photo');
        await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject;});db.close();return a;
      },bytes);
      await q.goto(url);await q.locator('#board .card').first().waitFor();
      const actual=await q.evaluate(async()=>{const {AlbumRepository}=await import('./storage.js'),r=await new AlbumRepository().open(),s=await r.load();r.db.close();return {album:s.album,hasPhoto:s.images.has('legacy-photo'),audio:s.recordings.size};});
      assert.equal(actual.album.version,2);assert.equal(actual.album.name,original.name);assert.deepEqual(actual.album.tabs,original.tabs);assert.deepEqual(actual.album.cards,original.cards);assert.equal(actual.hasPhoto,true);assert.equal(actual.audio,0);
    }finally{await isolated.close();}
  });
  await check('IDB rejects stale writes without partial album or image mutation', async () => {
    assert.ok(await page.evaluate(async () => {
      const { AlbumRepository } = await import('./storage.js'), r = await new AlbumRepository().open();
      const original = await r.load(), stale = structuredClone(original.album); stale.name = 'must not persist';
      let rejected = false; try { await r.save(stale, original.album.revision - 1, new Map([['orphan-image', new Blob(['invalid'])]])); } catch { rejected = true; }
      const after = await r.load(); r.db.close(); return rejected && after.album.name === original.album.name && !after.images.has('orphan-image');
    }));
  });
  await check('A16 offline shell and uploaded photo survive reload', async () => {
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })); });
    await context.setOffline(true); await page.reload(); await page.locator('#board .card').first().waitFor();
    await page.getByRole('button', { name: 'Еда и напитки', exact: true }).click();
    assert.ok(await card('Мой стакан').locator('img').evaluate(img => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: 'artifacts/tablet.png', fullPage: true }); await context.setOffline(false);
  });
  await check('Mobile at 390px stays within viewport at saved 130% scale', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.locator('#board .card').first().waitFor();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, panel: document.querySelector('#message-panel').getBoundingClientRect().bottom, tabs: document.querySelector('#tabs').getBoundingClientRect().bottom, panelTop: document.querySelector('#message-panel').getBoundingClientRect().top }));
    await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
    assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions)); assert.ok(dimensions.panel < 844); assert.ok(dimensions.tabs <= dimensions.panelTop);
  });
  await check('Install is next to settings; installation hides both controls and persists', async () => {
    await assertCount('.top-tools [data-action=install]', 0);
    await gate();
    await page.evaluate(() => {
      window.__installPrompts = 0;
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.__installPrompts++; };
      dispatchEvent(event);
    });
    assert.ok(await page.locator('[data-action=settings]').evaluate(el => el.nextElementSibling.dataset.action === 'install'));
    await page.setViewportSize({ width: 320, height: 640 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', { name: 'Установить приложение', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__installPrompts), 1);
    await assertCount('.top-tools [data-action=install]', 1);
    await page.screenshot({ path: 'artifacts/editor-install-320.png', fullPage: true });
    await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
    await assertCount('.top-tools [data-action=install]', 0);
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click(); assert.equal(await page.locator('#install').isVisible(), false);
    await page.locator('#dialog [data-action=close-dialog]').first().click();
    await page.reload(); await page.locator('#board .card').first().waitFor(); await gate();
    await assertCount('.top-tools [data-action=install]', 0);
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
  });
  await check('Touch pan and wheel over fixed heading scroll only cards without changing album', async () => {
    await page.setViewportSize({ width: 768, height: 700 });
    await page.evaluate(() => document.documentElement.style.setProperty('--card-scale', '1.5'));
    const original = await dbRead(), heading = await page.locator('#album-heading').boundingBox();
    const x = heading.x + heading.width * .6, y = heading.y + heading.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 180, y: y - 90, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const position = await page.locator('#board').evaluate(e => [e.scrollLeft,e.scrollTop]);
    assert.ok(position[0] > 0 && position[1] > 0, JSON.stringify(position));
    assert.deepEqual(await page.locator('#album-heading').boundingBox(), heading);
    assert.deepEqual(await dbRead(), original);
    await page.locator('#board').evaluate(e => { e.scrollLeft = e.scrollTop = 0; });
    await page.mouse.move(x,y); await page.mouse.wheel(100,100);
    await page.waitForFunction(() => document.querySelector('#board').scrollLeft > 0);
    assert.deepEqual(await page.locator('#album-heading').boundingBox(), heading);
    await page.screenshot({ path:'artifacts/fixed-heading-pan.png',fullPage:true });
  });
  await check('Real waiting worker: one adult update offer; deferred settings button; no child prompt', async () => {
    await page.setViewportSize({ width: 1180, height: 820 });
    const before = await dbRead();
    updatesOverride=JSON.stringify({releases:[{version:'0.2.2',changes:['Второе пропущенное обновление']},{version:'0.1.2',changes:['Уже установлено']},{version:'0.2.1',changes:['Первое пропущенное обновление']}]});
    swOverride = (await readFile(resolve(root, 'sw.js'), 'utf8')).replace(/const CACHE = '[^']+'/, "const CACHE = 'pecsoteka-update-acceptance'").replace(/const APP_VERSION = '[^']+'/,"const APP_VERSION = '0.2.2'");
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    await assertCount('#dialog[open]', 0);
    await gate(); await page.getByRole('heading', { name: 'Доступно обновление', exact: true }).waitFor();
    assert.deepEqual(await page.locator('#dialog [data-release-version]').evaluateAll(els=>els.map(e=>e.dataset.releaseVersion)),['0.2.1','0.2.2']);
    await page.screenshot({path:'artifacts/update-changes.png',fullPage:true});
    await page.getByRole('button', { name: 'Позже', exact: true }).click();
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await gate(); await assertCount('#dialog[open]', 0);
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click();
    assert.equal(await page.locator('#update-banner').isVisible(), true);
    assert.deepEqual(await page.locator('#update-banner [data-release-version]').evaluateAll(els=>els.map(e=>e.dataset.releaseVersion)),['0.2.1','0.2.2']);
    await page.locator('#settings-form [name=name]').fill('Несохранённое имя');
    await page.locator('#dialog [data-action=close-dialog]').first().click();
    await page.locator('#confirm-dialog [data-confirm=no]').last().click();
    assert.equal(await page.locator('#settings-form [name=name]').inputValue(), 'Несохранённое имя');
    await page.locator('#dialog [data-action=close-dialog]').first().click(); await page.locator('#confirm-dialog [data-confirm=yes]').click();
    await page.reload(); await page.locator('#board .card').first().waitFor(); await gate();
    await assertCount('#dialog[open]', 0);
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click();
    assert.equal(await page.locator('#update-banner').isVisible(), true);
    await page.screenshot({ path: 'artifacts/update-settings.png', fullPage: true });
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.getByRole('button', { name: 'Обновить приложение', exact: true }).click()]);
    await page.locator('#board .card').first().waitFor(); await assertCount('.app.editing', 0);
    assert.deepEqual(await dbRead(), before);
    assert.equal(await page.evaluate(async () => {
      const channel = new MessageChannel();
      return await new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data.version); navigator.serviceWorker.controller.postMessage({type:'GET_VERSION'},[channel.port2]); });
    }), 'pecsoteka-update-acceptance');
  });
  assert.deepEqual(errors, [], 'No unhandled browser errors or native message dialogs');
  console.log(`Browser acceptance: ${results.length} scenarios passed; screenshots in artifacts/`);
} finally {
  await browser?.close(); server.close();
}
