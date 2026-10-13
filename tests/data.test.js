import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DataError,
  loadBuckets,
  createDictionary,
  validateInput,
} from '../src/data.js';
import { loadFixture } from './helpers/fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'patterns');

const dict4 = loadFixture(4);
const dict3 = loadFixture(3);

const words4 = ['bold', 'bolt', 'card', 'cola', 'cold', 'cord', 'core', 'quiz'];
const words3 = ['bat', 'cat', 'cog', 'cot', 'dog', 'dot'];
const fixtures = [
  [dict4, words4],
  [dict3, words3],
];

function rawFixture(length) {
  return JSON.parse(readFileSync(join(fixtureDir, `${length}.json`), 'utf8'));
}

function stubFetch(response) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return response;
  };
  fn.calls = calls;
  return fn;
}

test('DL-1: neighbors of cold', () => {
  assert.deepEqual(dict4.neighbors('cold'), ['bold', 'cola', 'cord']);
});

test('DL-2: neighbors of bold and quiz', () => {
  assert.deepEqual(dict4.neighbors('bold'), ['bolt', 'cold']);
  assert.deepEqual(dict4.neighbors('quiz'), []);
});

test('DL-3: neighbors never self and always differ by one letter', () => {
  for (const [dict, words] of fixtures) {
    for (const word of words) {
      for (const neighbor of dict.neighbors(word)) {
        assert.notEqual(neighbor, word, `${word} -> ${neighbor}`);
        let diff = 0;
        for (let i = 0; i < word.length; i++) if (word[i] !== neighbor[i]) diff++;
        assert.equal(diff, 1, `${word} -> ${neighbor}`);
      }
    }
  }
});

test('DL-4: adjacency is symmetric', () => {
  for (const [dict, words] of fixtures) {
    for (const a of words) {
      for (const b of words) {
        const hasB = dict.neighbors(a).includes(b);
        const hasA = dict.neighbors(b).includes(a);
        assert.equal(hasB, hasA, `${a} <-> ${b}`);
      }
    }
  }
});

test('DL-5: has is length- and case-sensitive', () => {
  assert.equal(dict4.has('cold'), true);
  assert.equal(dict4.has('colt'), false);
  assert.equal(dict4.has('COLD'), false);
  assert.equal(dict4.has('col'), false);
  assert.equal(dict4.has(42), false);
});

test('DL-6: neighbors of an unknown word throws UNKNOWN_WORD', () => {
  assert.throws(
    () => dict4.neighbors('colt'),
    (error) => error instanceof DataError && error.code === 'UNKNOWN_WORD',
  );
});

test('DL-7: mutating the returned array does not affect the cache', () => {
  const first = dict4.neighbors('cold');
  first.push('zzzz');
  assert.deepEqual(dict4.neighbors('cold'), ['bold', 'cola', 'cord']);
});

test('DL-8: loadBuckets resolves and caches per (baseUrl, length)', async () => {
  const fetch = stubFetch({ status: 200, ok: true, json: async () => rawFixture(4) });
  const baseUrl = 'test://dl8/';
  const buckets = await loadBuckets(4, { baseUrl, fetch });
  assert.doesNotThrow(() => createDictionary(buckets, 4));
  const again = await loadBuckets(4, { baseUrl, fetch });
  assert.equal(again, buckets);
  assert.equal(fetch.calls.length, 1);
});

test('DL-9: load failures carry the right code and are retried', async () => {
  const notFound = stubFetch({ status: 404, ok: false, json: async () => ({}) });
  await assert.rejects(
    loadBuckets(4, { baseUrl: 'test://dl9-404/', fetch: notFound }),
    (error) => error instanceof DataError && error.code === 'NOT_FOUND',
  );

  const offline = async () => {
    throw new Error('network down');
  };
  await assert.rejects(
    loadBuckets(4, { baseUrl: 'test://dl9-net/', fetch: offline }),
    (error) => error instanceof DataError && error.code === 'LOAD_FAILED',
  );

  const badJson = stubFetch({ status: 200, ok: true, json: async () => { throw new Error('bad'); } });
  await assert.rejects(
    loadBuckets(4, { baseUrl: 'test://dl9-json/', fetch: badJson }),
    (error) => error instanceof DataError && error.code === 'BAD_FORMAT',
  );

  const flaky = stubFetch({ status: 500, ok: false, json: async () => ({}) });
  await assert.rejects(loadBuckets(4, { baseUrl: 'test://dl9-retry/', fetch: flaky }));
  await assert.rejects(loadBuckets(4, { baseUrl: 'test://dl9-retry/', fetch: flaky }));
  assert.equal(flaky.calls.length, 2);
});

test('DL-10: createDictionary rejects bad shapes', () => {
  assert.throws(() => createDictionary({}), (error) => error.code === 'BAD_FORMAT');
  assert.throws(() => createDictionary({ abc: [] }), (error) => error.code === 'BAD_FORMAT');
  assert.throws(() => createDictionary({ '*a*d': [] }), (error) => error.code === 'BAD_FORMAT');
});

test('DL-11: validateInput reports the first failure in order', () => {
  const results = [
    [validateInput(dict4, '', 'warm'), 'EMPTY'],
    [validateInput(dict4, 'a1', 'warm'), 'INVALID_CHARS'],
    [validateInput(dict4, 'ab', 'warm'), 'LENGTH_MISMATCH'],
    [validateInput(dict4, 'ab', 'cd'), 'UNSUPPORTED_LENGTH'],
    [validateInput(dict3, 'cold', 'warm'), 'WRONG_DICTIONARY'],
    [validateInput(dict4, 'xxxx', 'core'), 'UNKNOWN_START'],
    [validateInput(dict4, 'core', 'xxxx'), 'UNKNOWN_END'],
  ];
  for (const [result, code] of results) {
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
  }
  assert.equal(validateInput(dict4, '', 'a1').code, 'EMPTY');
  assert.deepEqual(validateInput(dict4, 'COLD', 'Cord'), { ok: true, start: 'cold', end: 'cord' });
});

test('DL-11b: a null dictionary runs the pre-check (codes 1-4) without throwing', () => {
  assert.deepEqual(validateInput(null, 'cold', 'warm'), { ok: true, start: 'cold', end: 'warm' });
  assert.deepEqual(validateInput(undefined, ' COLD ', 'Warm'), { ok: true, start: 'cold', end: 'warm' });
  assert.equal(validateInput(null, '', 'warm').code, 'EMPTY');
  assert.equal(validateInput(null, 'a1', 'warm').code, 'INVALID_CHARS');
  assert.equal(validateInput(null, 'ab', 'warm').code, 'LENGTH_MISMATCH');
  assert.equal(validateInput(null, 'ab', 'cd').code, 'UNSUPPORTED_LENGTH');
});

test('DL-12: fixture files match the file-format contract', () => {
  for (const length of [3, 4]) {
    const buckets = rawFixture(length);
    const keys = Object.keys(buckets);
    assert.deepEqual(keys, [...keys].sort(), `length ${length}: keys not sorted`);
    for (const key of keys) {
      assert.equal(key.length, length, key);
      assert.equal(key.split('*').length - 1, 1, key);
      assert.deepEqual(buckets[key], [...buckets[key]].sort(), `${key} not sorted`);
    }
    for (const word of words3.concat(words4)) {
      if (word.length !== length) continue;
      let appearances = 0;
      for (const key of keys) if (buckets[key].includes(word)) appearances++;
      assert.equal(appearances, length, `${word} appears in ${appearances} buckets`);
    }
  }
});
