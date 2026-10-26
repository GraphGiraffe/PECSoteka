import test from 'node:test';
import assert from 'node:assert/strict';
import { Speech } from '../public/services.js';
import { defaults } from '../public/domain.js';

const local = { lang: 'ru-RU', voiceURI: 'local-ru', localService: true };
const remote = { lang: 'ru-RU', voiceURI: 'remote-ru', localService: false };
function platform(t, initial = []) {
  let voices = initial;
  const previousWindow = globalThis.window, previousUtterance = globalThis.SpeechSynthesisUtterance;
  const synth = new EventTarget(), spoken = [];
  synth.getVoices = () => voices;
  synth.cancel = () => {};
  synth.speak = u => spoken.push(u);
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance };
  t.after(() => { globalThis.window = previousWindow; globalThis.SpeechSynthesisUtterance = previousUtterance; });
  return { spoken, setVoices(next, notify = true) { voices = next; if (notify) synth.dispatchEvent(new Event('voiceschanged')); } };
}
test('first request waits for asynchronously supplied voices and speaks without another press', async t => {
  const p = platform(t), speech = new Speech({ ...defaults }, () => {});
  const first = speech.say('Я хочу воды');
  assert.equal(p.spoken.length, 0);
  p.setVoices([local]);
  await first;
  assert.equal(p.spoken.length, 1); assert.equal(p.spoken[0].text, 'Я хочу воды');
});
test('available voice speaks synchronously within the original user action', async t => {
  const p = platform(t, [local]), speech = new Speech({ ...defaults }, () => {});
  const request = speech.say('Сразу'); assert.equal(p.spoken.length, 1); await request;
});
test('limited fallback checks handle engines that omit voiceschanged', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = platform(t), speech = new Speech({ ...defaults }, () => {});
  const request = speech.say('Без события'); p.setVoices([local], false);
  t.mock.timers.tick(300); await request; assert.equal(p.spoken.length, 1);
});
test('stopping a pending request prevents speech after late voice discovery', async t => {
  const p = platform(t), speech = new Speech({ ...defaults }, () => {});
  const request = speech.say('Отменено'); speech.stop(); p.setVoices([local]);
  await request; assert.equal(p.spoken.length, 0);
});
test('a newer request replaces a pending one instead of layering both', async t => {
  const p = platform(t), speech = new Speech({ ...defaults }, () => {});
  const first = speech.say('Первое'), second = speech.say('Второе');
  p.setVoices([local]); await Promise.all([first, second]);
  assert.deepEqual(p.spoken.map(u => u.text), ['Второе']);
});
test('timeout reports unavailability and does not silently choose a network voice', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = platform(t, [remote]), speech = new Speech({ ...defaults }, () => {});
  const rejected = assert.rejects(speech.say('Без согласия'), /пока недоступен/);
  t.mock.timers.tick(3000); await rejected; assert.equal(p.spoken.length, 0);
  speech.settings = { ...defaults, voiceURI: remote.voiceURI };
  await speech.say('С выбранным голосом'); assert.equal(p.spoken[0].voice, remote);
});
