import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAstar } from '../src/search/astar.js';
import { runBfs } from '../src/search/bfs.js';
import { runSearch, algorithms } from '../src/search/index.js';
import { validateEvents } from '../src/events.js';
import { hammingDistance } from '../src/search/heuristics.js';
import { loadFixture } from './helpers/fixtures.js';

const dict4 = loadFixture(4);
const dict3 = loadFixture(3);

const words4 = ['bold', 'bolt', 'card', 'cola', 'cold', 'cord', 'core', 'quiz'];
const words3 = ['bat', 'cat', 'cog', 'cot', 'dog', 'dot'];

function orderedPairs(words) {
  const pairs = [];
  for (const start of words) {
    for (const end of words) pairs.push([start, end]);
  }
  return pairs;
}

const fixtures = [
  [dict4, words4],
  [dict3, words3],
];

test('AS-1: A* found and path length match BFS for every ordered pair', () => {
  for (const [dict, words] of fixtures) {
    for (const [start, end] of orderedPairs(words)) {
      const astar = runAstar(dict, start, end);
      const bfs = runBfs(dict, start, end);
      assert.equal(astar.found, bfs.found, `${start} -> ${end}: found`);
      if (bfs.found) {
        assert.equal(astar.path.length, bfs.path.length, `${start} -> ${end}: path length`);
      }
    }
  }
});

test('AS-2: validateEvents passes for every ordered pair in both fixtures', () => {
  for (const [dict, words] of fixtures) {
    for (const [start, end] of orderedPairs(words)) {
      const result = runAstar(dict, start, end);
      const validation = validateEvents(result, dict);
      assert.equal(validation.ok, true, `${start} -> ${end}: ${validation.errors?.join('; ')}`);
    }
  }
});

test('AS-2b: a maxVisits-limited run still validates', () => {
  const result = runAstar(dict4, 'bolt', 'core', { maxVisits: 1 });
  const validation = validateEvents(result, dict4, { maxVisits: 1 });
  assert.equal(validation.ok, true, validation.errors?.join('; '));
  assert.equal(result.found, false);
  assert.equal(result.events.at(-1).reason, 'limit');
});

test('AS-3: start === end returns [discover, visit, path] with a score', () => {
  const result = runAstar(dict4, 'bolt', 'bolt');
  assert.deepEqual(result.events.map((event) => event.type), ['discover', 'visit', 'path']);
  assert.deepEqual(result.path, ['bolt']);
  assert.equal(result.events[0].score, hammingDistance('bolt', 'bolt'));
});

test('AS-4: bolt -> quiz is unreachable', () => {
  const result = runAstar(dict4, 'bolt', 'quiz');
  assert.equal(result.found, false);
  assert.equal(result.path, null);
  assert.deepEqual(result.events.at(-1), { type: 'fail', reason: 'unreachable' });
});

test('AS-5: on the 4-letter fixture every discover scores depth + hamming', () => {
  for (const end of ['core', 'cola', 'card']) {
    const result = runAstar(dict4, 'bolt', end);
    for (const event of result.events) {
      if (event.type === 'discover') {
        assert.equal(event.score, event.depth + hammingDistance(event.word, end));
      }
    }
  }
});

test('AS-6: determinism - two runs are deep-equal', () => {
  assert.deepEqual(runAstar(dict4, 'bolt', 'core'), runAstar(dict4, 'bolt', 'core'));
});

test('AS-7: reparent golden', () => {
  const dict = fakeReparentDictionary();
  const result = runAstar(dict, 's', 't', { heuristic: reparentHeuristic() });
  const expected = [
    { type: 'discover', word: 's', from: null, depth: 0, score: 0 },
    { type: 'visit', word: 's' },
    { type: 'discover', word: 'a', from: 's', depth: 1, score: 1 },
    { type: 'discover', word: 'c', from: 's', depth: 1, score: 6 },
    { type: 'visit', word: 'a' },
    { type: 'discover', word: 'b', from: 'a', depth: 2, score: 2 },
    { type: 'visit', word: 'b' },
    { type: 'discover', word: 'x', from: 'b', depth: 3, score: 13 },
    { type: 'visit', word: 'c' },
    { type: 'reparent', word: 'x', from: 'c', depth: 2, score: 12, prevFrom: 'b', prevDepth: 3, prevScore: 13 },
    { type: 'visit', word: 'x' },
    { type: 'discover', word: 't', from: 'x', depth: 3, score: 3 },
    { type: 'visit', word: 't' },
    { type: 'path', words: ['s', 'c', 'x', 't'] },
  ];
  assert.equal(result.events.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(result.events[i], expected[i], `event ${i + 1}`);
  }
  assert.deepEqual(result.stats, { discovered: 6, visited: 6, pathLength: 3 });
  assert.deepEqual(result.path, ['s', 'c', 'x', 't']);
});

test('AS-8: validateEvents accepts the golden and rejects a bad reparent', () => {
  const dict = fakeReparentDictionary();
  const result = runAstar(dict, 's', 't', { heuristic: reparentHeuristic() });
  assert.deepEqual(validateEvents(result, dict), { ok: true });

  const corrupted = JSON.parse(JSON.stringify(result));
  const reparent = corrupted.events.find((event) => event.type === 'reparent');
  reparent.depth = reparent.prevDepth;
  const validation = validateEvents(corrupted, dict);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.startsWith('V5')), validation.errors.join('; '));
});

test('AS-9: a constant-0 heuristic makes A* agree with BFS', () => {
  for (const [dict, words] of fixtures) {
    for (const [start, end] of orderedPairs(words)) {
      const astar = runAstar(dict, start, end, { heuristic: () => 0 });
      const bfs = runBfs(dict, start, end);
      assert.equal(astar.found, bfs.found, `${start} -> ${end}: found`);
      if (bfs.found) {
        assert.equal(astar.path.length, bfs.path.length, `${start} -> ${end}: path length`);
      }
    }
  }
});

test('EV-4 (A* slice): unknown words throw SearchInputError with the right code', () => {
  assert.throws(() => runAstar(dict4, 'zzzz', 'core'), (error) => {
    assert.equal(error.name, 'SearchInputError');
    assert.equal(error.code, 'UNKNOWN_START');
    return true;
  });
  assert.throws(() => runAstar(dict4, 'bolt', 'zzzz'), (error) => {
    assert.equal(error.code, 'UNKNOWN_END');
    return true;
  });
});

test('registry: runSearch dispatches to A* and rejects unknown ids', () => {
  assert.deepEqual(runSearch('astar', dict4, 'bolt', 'core'), runAstar(dict4, 'bolt', 'core'));
  assert.equal(algorithms.astar.frontierMode, 'priority-f');
  assert.throws(() => runSearch('nope', dict4, 'bolt', 'core'), /Unknown algorithm/);
});

function fakeReparentDictionary() {
  const edges = {
    s: ['a', 'c'],
    a: ['b', 's'],
    b: ['a', 'x'],
    c: ['s', 'x'],
    x: ['b', 'c', 't'],
    t: ['x'],
  };
  return {
    has: (word) => Object.prototype.hasOwnProperty.call(edges, word),
    neighbors: (word) => edges[word] ?? [],
  };
}

function reparentHeuristic() {
  const values = { s: 0, a: 0, b: 0, c: 5, x: 10, t: 0 };
  return (word) => values[word] ?? 0;
}
