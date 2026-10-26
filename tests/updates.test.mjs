import test from 'node:test';
import assert from 'node:assert/strict';
import { releasesBetween } from '../public/pwa.js';

test('all skipped releases are shown in ascending version order', () => {
  const history = ['0.1.3','0.1.1','0.1.2','0.1.0'].map(version => ({ version, changes:[`Изменение ${version}`] }));
  assert.deepEqual(releasesBetween(history,'0.1.0','0.1.3').map(r=>r.version),['0.1.1','0.1.2','0.1.3']);
});
test('version comparisons are numeric and exclude installed and later releases', () => {
  const history = ['0.1.2','0.1.9','0.1.10','0.2.0'].map(version=>({version,changes:['Изменение']}));
  assert.deepEqual(releasesBetween(history,'0.1.9','0.1.10').map(r=>r.version),['0.1.10']);
  assert.deepEqual(releasesBetween(history,'0.1.10','0.1.10'),[]);
});
test('malformed records are ignored without inventing or duplicating notes', () => {
  const history = [null,{version:'bad',changes:['bad']},{version:'0.1.1',changes:[]},{version:'0.1.2',changes:[null,' Второе ']},{version:'0.1.2',changes:[' Второе ']}];
  assert.deepEqual(releasesBetween(history,'0.1.0','0.1.3'),[{version:'0.1.2',changes:['Второе']}]);
  assert.deepEqual(releasesBetween({},'0.1.0','0.1.3'),[]);
});
