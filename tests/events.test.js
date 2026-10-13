import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvents } from '../src/events.js';
import { runBfs } from '../src/search/bfs.js';
import { runAstar } from '../src/search/astar.js';
import { runSearch, algorithms, SearchInputError } from '../src/search/index.js';
import { loadFixture, fixtureWords } from './helpers/fixtures.js';

const dict4 = loadFixture(4);
const dict3 = loadFixture(3);

const fixtures = [
  [dict4, fixtureWords[4]],
  [dict3, fixtureWords[3]],
];

function orderedPairs(words) {
  const pairs = [];
  for (const start of words) for (const end of words) pairs.push([start, end]);
  return pairs;
}

function clone(value) {
  return structuredClone(value);
}

function namesRule(result, dict, rule) {
  const validation = validateEvents(result, dict);
  return validation.ok === false && validation.errors.some((error) => error.startsWith(`${rule}:`));
}

function as7Result() {
  const edges = {
    s: ['a', 'c'],
    a: ['b', 's'],
    b: ['a', 'x'],
    c: ['s', 'x'],
    x: ['b', 't'],
    t: ['x'],
  };
  const dict = {
    has: (word) => Object.prototype.hasOwnProperty.call(edges, word),
    neighbors: (word) => edges[word] ?? [],
  };
  const h = { s: 0, a: 0, b: 0, c: 5, x: 10, t: 0 };
  return runAstar(dict, 's', 't', { heuristic: (word) => h[word] ?? 0 });
}

test('EV-1: the BFS golden result validates', () => {
  const result = runBfs(dict4, 'bolt', 'core');
  assert.deepEqual(validateEvents(result, dict4), { ok: true });
});

test('EV-2: each rule rejects a corrupted result by name', () => {
  const found = clone(runBfs(dict4, 'bolt', 'core'));
  const unreachable = clone(runBfs(dict4, 'bolt', 'quiz'));

  // V1 - wrong field type.
  const v1 = clone(found);
  v1.stats.discovered = 'many';
  assert.ok(namesRule(v1, dict4, 'V1'), 'V1');

  // V2 - event 1 is not discover(start, null, 0).
  const v2 = clone(found);
  v2.events[0].from = 'bolt';
  assert.ok(namesRule(v2, dict4, 'V2'), 'V2');

  // V3 - unknown event type.
  const v3 = clone(found);
  v3.events[1] = { type: 'bogus' };
  assert.ok(namesRule(v3, dict4, 'V3'), 'V3');

  // V4 - a word is discovered twice.
  const v4 = clone(found);
  v4.events[2].word = 'bolt';
  assert.ok(namesRule(v4, dict4, 'V4'), 'V4');

  // V5 - a reparent whose new depth is not smaller.
  const v5 = clone(as7Result());
  const reparent = v5.events.find((event) => event.type === 'reparent');
  reparent.depth = reparent.prevDepth;
  assert.ok(namesRule(v5, as7ResultDict(), 'V5'), 'V5');

  // V6 - the same word is visited twice.
  const v6 = clone(found);
  v6.events.splice(1, 0, { type: 'visit', word: 'bolt' });
  assert.ok(namesRule(v6, dict4, 'V6'), 'V6');

  // V7 - no terminal event.
  const v7 = clone(found);
  v7.events.pop();
  assert.ok(namesRule(v7, dict4, 'V7'), 'V7');

  // V8 - path does not end at end.
  const v8 = clone(found);
  v8.path[v8.path.length - 1] = 'quiz';
  assert.ok(namesRule(v8, dict4, 'V8'), 'V8');

  // V9 - a failing result with a non-null path.
  const v9 = clone(unreachable);
  v9.path = ['bolt'];
  assert.ok(namesRule(v9, dict4, 'V9'), 'V9');

  // V10 - wrong stats.
  const v10 = clone(found);
  v10.stats.visited = 999;
  assert.ok(namesRule(v10, dict4, 'V10'), 'V10');

  // V11 - unknown algorithm.
  const v11 = clone(found);
  v11.algorithm = 'nope';
  assert.ok(namesRule(v11, dict4, 'V11'), 'V11');

  // V12 - BFS must not carry scores.
  const v12 = clone(found);
  v12.events[0].score = 3;
  assert.ok(namesRule(v12, dict4, 'V12'), 'V12');
});

test('EV-3: every algorithm validates for every ordered pair in both fixtures', () => {
  for (const id of Object.keys(algorithms)) {
    for (const [dict, words] of fixtures) {
      for (const [start, end] of orderedPairs(words)) {
        const result = runSearch(id, dict, start, end);
        const validation = validateEvents(result, dict);
        assert.equal(validation.ok, true, `${id} ${start} -> ${end}: ${validation.errors?.join('; ')}`);
      }
    }
  }
});

test('EV-4: unknown ids and unknown words throw the right errors', () => {
  assert.throws(() => runSearch('nope', dict4, 'bolt', 'core'));
  const missingStart = () => runSearch('bfs', dict4, 'xxxx', 'core');
  assert.throws(missingStart, (error) => error instanceof SearchInputError && error.code === 'UNKNOWN_START');
  const missingEnd = () => runSearch('bfs', dict4, 'core', 'xxxx');
  assert.throws(missingEnd, (error) => error instanceof SearchInputError && error.code === 'UNKNOWN_END');
  assert.throws(
    () => algorithms.astar.run(dict4, 'xxxx', 'core'),
    (error) => error instanceof SearchInputError && error.code === 'UNKNOWN_START',
  );
});

test('EV-5: maxVisits 1 yields a validated limit failure for every algorithm', () => {
  for (const id of Object.keys(algorithms)) {
    const result = runSearch(id, dict4, 'bolt', 'core', { maxVisits: 1 });
    assert.equal(result.found, false, id);
    assert.deepEqual(result.events.at(-1), { type: 'fail', reason: 'limit' }, id);
    assert.deepEqual(validateEvents(result, dict4, { maxVisits: 1 }), { ok: true }, id);
  }
});

test('EV-6: every algorithm is deterministic', () => {
  for (const id of Object.keys(algorithms)) {
    for (const [start, end] of [['bolt', 'core'], ['bolt', 'quiz'], ['cat', 'dog']]) {
      const dict = start.length === 3 ? dict3 : dict4;
      assert.deepEqual(runSearch(id, dict, start, end), runSearch(id, dict, start, end), `${id} ${start}->${end}`);
    }
  }
});

function as7ResultDict() {
  const edges = {
    s: ['a', 'c'],
    a: ['b', 's'],
    b: ['a', 'x'],
    c: ['s', 'x'],
    x: ['b', 't'],
    t: ['x'],
  };
  return {
    has: (word) => Object.prototype.hasOwnProperty.call(edges, word),
    neighbors: (word) => edges[word] ?? [],
  };
}
