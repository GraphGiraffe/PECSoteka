import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { numberToWords } from '../public/domain.js';

const root = resolve(process.env.SITE_DIR || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/PECSoteka/')) { res.writeHead(404).end(); return; }
    const file = resolve(root, pathname.slice('/PECSoteka/'.length) || 'index.html');
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
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
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, acceptDownloads: true });
  await context.addInitScript(() => {
    window.__speechCalls = []; window.__cancels = 0; window.__oscillators = 0;
    // Simulate the complete platform boundary. A native utterance rejects a
    // plain JS voice, so mixing a real utterance with fake voices is invalid.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ lang: 'ru-RU', voiceURI: 'test-ru', name: 'Test Russian', localService: true }],
      cancel: () => { window.__cancels++; }, speak: u => { window.__speechCalls.push(u.text); },
      addEventListener() {}, removeEventListener() {}
    } });
    if (window.AudioContext) { const fn = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function(...args) { window.__oscillators++; return fn.apply(this, args); }; }
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
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
    const before = await dbRead(); await page.getByText('Удаление локальных данных', { exact: true }).click(); await page.locator('#reset-album').click(); await page.locator('#settings-form').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click(); await page.locator('#import-file').setInputFiles(file); await page.locator('#settings-form').waitFor({ state: 'detached' });
    const after = await dbRead(); delete before.revision; delete after.revision; assert.deepEqual(after, before);
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
  assert.deepEqual(errors, [], 'No unhandled browser errors');
  console.log(`Browser acceptance: ${results.length} scenarios passed; screenshots in artifacts/`);
} finally {
  await browser?.close(); server.close();
}
