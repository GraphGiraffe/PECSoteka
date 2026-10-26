import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbum, numberToWords, addToLine, homeOf, moveCard, validateAlbum, removeCard, phrase } from '../public/domain.js';

test('Russian four-digit gate numbers have correct gender and thousands declension', () => {
  for (const [n, text] of [[1000, 'одна тысяча'], [1001, 'одна тысяча один'], [2002, 'две тысячи два'], [2437, 'две тысячи четыреста тридцать семь'], [3011, 'три тысячи одиннадцать'], [4019, 'четыре тысячи девятнадцать'], [5000, 'пять тысяч'], [6110, 'шесть тысяч сто десять'], [9999, 'девять тысяч девятьсот девяносто девять']]) assert.equal(numberToWords(n), text);
  assert.throws(() => numberToWords(999), RangeError);
  assert.throws(() => numberToWords(10000), RangeError);
  assert.throws(() => numberToWords(2437.5), RangeError);
});
test('gate wording is distinct and contains no digits for all 9000 supported challenges', () => {
  const results = Array.from({ length: 9000 }, (_, i) => numberToWords(i + 1000));
  assert.equal(new Set(results).size, 9000);
  assert.ok(results.every(s => !/\d|\s{2}/.test(s)));
});
test('communication selection preserves the exact home slot and album data', () => {
  const a = createAlbum(), before = structuredClone(a), id = a.tabs[0].columns[0].cardIds[0];
  const line = addToLine(a, [], id);
  assert.deepEqual(a, before);
  assert.deepEqual(line[0].source, homeOf(a, id));
  assert.equal(line[0].mode, 'communication');
  assert.equal(addToLine(a, line, id), line);
  assert.deepEqual(homeOf(a, id), line[0].source);
});
test('copy mode permits separate word instances with the same source', () => {
  const a = createAlbum(), id = Object.keys(a.cards)[0]; a.settings.copyCards = true;
  const line = addToLine(a, addToLine(a, [], id), id);
  assert.equal(line.length, 2); assert.notEqual(line[0].instanceId, line[1].instanceId);
  assert.deepEqual(line[0].source, line[1].source);
});
test('pending moves do not change persistence and never duplicate a pending card', () => {
  const a = createAlbum(), before = structuredClone(a), id = Object.keys(a.cards)[0];
  a.settings.copyCards = true; before.settings.copyCards = true;
  const buffer = addToLine(a, [], id, 'pendingMove');
  assert.equal(addToLine(a, buffer, id, 'pendingMove'), buffer);
  assert.equal(buffer[0].mode, 'pendingMove'); assert.deepEqual(a, before);
  assert.deepEqual(homeOf(a, id), buffer[0].source);
});
test('editor move inserts before an occupied target and preserves every other card', () => {
  const a = createAlbum(), id = a.tabs[0].columns[0].cardIds[0], col = a.tabs[1].columns[0], previous = [...col.cardIds];
  const moved = moveCard(a, id, { tabId: a.tabs[1].id, columnId: col.id, index: 0 });
  assert.deepEqual(moved.tabs[1].columns[0].cardIds, [id, ...previous]);
  assert.equal(a.tabs[0].columns[0].cardIds[0], id);
  assert.equal(moved.tabs[0].columns[0].cardIds.includes(id), false);
  assert.doesNotThrow(() => validateAlbum(moved));
  assert.equal(Object.keys(moved.cards).length, Object.keys(a.cards).length);
});
test('same-column moves account for removal before insertion', () => {
  const a = createAlbum(), col = a.tabs[0].columns[0], [first, second] = col.cardIds;
  const moved = moveCard(a, first, { tabId: a.tabs[0].id, columnId: col.id, index: 2 });
  assert.deepEqual(moved.tabs[0].columns[0].cardIds, [second, first]);
  const same = moveCard(a, first, { tabId: a.tabs[0].id, columnId: col.id, index: 0 });
  assert.deepEqual(same, a);
});
test('invalid drops fail without mutating their source', () => {
  const a = createAlbum(), before = structuredClone(a), id = Object.keys(a.cards)[0];
  assert.throws(() => moveCard(a, id, { tabId: 'absent', columnId: 'absent', index: 0 }));
  assert.throws(() => moveCard(a, id, { ...homeOf(a, id), index: -1 }));
  assert.throws(() => moveCard(a, 'missing', homeOf(a, id)));
  assert.deepEqual(a, before);
});
test('deleting a card removes the one persistent reference', () => {
  const a = createAlbum(), id = Object.keys(a.cards)[0]; removeCard(a, id);
  assert.equal(homeOf(a, id), null); assert.equal(a.cards[id], undefined);
  assert.doesNotThrow(() => validateAlbum(a));
});
test('spoken message uses speech phrases in line order', () => {
  const a = createAlbum(), [x, y] = Object.keys(a.cards); a.cards[x].speechText = 'Я хочу'; a.cards[y].speechText = 'воды';
  assert.equal(phrase(a, [{ cardId: x }, { cardId: y }]), 'Я хочу воды');
  assert.equal(phrase(a, [{ cardId: y }, { cardId: x }]), 'воды Я хочу');
});
test('backup validator rejects duplicate homes, orphan cards and unknown versions', () => {
  const a = createAlbum(), first = Object.keys(a.cards)[0];
  for (const corrupt of [b => b.tabs[1].columns[0].cardIds.push(first), b => b.tabs[0].columns[0].cardIds.shift(), b => { b.version = 99; }, b => { b.settings.cardScale = 0; }, b => { b.cards[first].icon = '../../remote'; }]) {
    const b = structuredClone(a); corrupt(b); assert.throws(() => validateAlbum(b));
  }
});
test('validator keeps only known fields and does not trust image URLs', () => {
  const a = createAlbum(), first = Object.keys(a.cards)[0]; a.cards[first].imageURL = 'https://external.example/photo'; a.settings.pin = '1234';
  const clean = validateAlbum(a); assert.equal(clean.cards[first].imageURL, undefined); assert.equal(clean.settings.pin, undefined);
});
