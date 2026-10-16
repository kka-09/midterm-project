import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGreedy } from '../src/search/greedy.js';
import { runBfs } from '../src/search/bfs.js';
import { validateEvents } from '../src/events.js';
import { hammingDistance } from '../src/search/heuristics.js';
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

test('GR-1: bolt -> core golden events', () => {
  const result = runGreedy(dict4, 'bolt', 'core');
  const expected = [
    { type: 'discover', word: 'bolt', from: null, depth: 0, score: 3 },
    { type: 'visit', word: 'bolt' },
    { type: 'discover', word: 'bold', from: 'bolt', depth: 1, score: 3 },
    { type: 'visit', word: 'bold' },
    { type: 'discover', word: 'cold', from: 'bold', depth: 2, score: 2 },
    { type: 'visit', word: 'cold' },
    { type: 'discover', word: 'cola', from: 'cold', depth: 3, score: 2 },
    { type: 'discover', word: 'cord', from: 'cold', depth: 3, score: 1 },
    { type: 'visit', word: 'cord' },
    { type: 'discover', word: 'card', from: 'cord', depth: 4, score: 2 },
    { type: 'discover', word: 'core', from: 'cord', depth: 4, score: 0 },
    { type: 'visit', word: 'core' },
    { type: 'path', words: ['bolt', 'bold', 'cold', 'cord', 'core'] },
  ];
  assert.equal(result.events.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(result.events[i], expected[i], `event ${i + 1}`);
  }
  assert.deepEqual(result.stats, { discovered: 7, visited: 5, pathLength: 4 });
  assert.equal(result.found, true);
});

test('GR-2: suboptimal golden on a fake dictionary', () => {
  const dict = fakeGreedyDictionary();
  const result = runGreedy(dict, 's', 't', { heuristic: greedyHeuristic() });
  const expected = [
    { type: 'discover', word: 's', from: null, depth: 0, score: 9 },
    { type: 'visit', word: 's' },
    { type: 'discover', word: 'a', from: 's', depth: 1, score: 1 },
    { type: 'discover', word: 'c', from: 's', depth: 1, score: 5 },
    { type: 'visit', word: 'a' },
    { type: 'discover', word: 'b', from: 'a', depth: 2, score: 1 },
    { type: 'visit', word: 'b' },
    { type: 'discover', word: 'd', from: 'b', depth: 3, score: 1 },
    { type: 'visit', word: 'd' },
    { type: 'discover', word: 't', from: 'd', depth: 4, score: 0 },
    { type: 'visit', word: 't' },
    { type: 'path', words: ['s', 'a', 'b', 'd', 't'] },
  ];
  assert.equal(result.events.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(result.events[i], expected[i], `event ${i + 1}`);
  }
  assert.deepEqual(result.stats, { discovered: 6, visited: 5, pathLength: 4 });
  const bfs = runBfs(dict, 's', 't');
  assert.deepEqual(bfs.path, ['s', 'c', 't']);
});

test('GR-3: bolt -> quiz is unreachable', () => {
  const result = runGreedy(dict4, 'bolt', 'quiz');
  assert.equal(result.found, false);
  assert.equal(result.path, null);
  assert.deepEqual(result.events.at(-1), { type: 'fail', reason: 'unreachable' });
});

test('GR-4: start === end', () => {
  const result = runGreedy(dict4, 'bolt', 'bolt');
  assert.deepEqual(result.events.map((event) => event.type), ['discover', 'visit', 'path']);
  assert.deepEqual(result.path, ['bolt']);
  assert.equal(result.events[0].score, hammingDistance('bolt', 'bolt'));
});

test('GR-5: matches BFS found and never beats BFS path length', () => {
  for (const [dict, words] of fixtures) {
    for (const [start, end] of orderedPairs(words)) {
      const greedy = runGreedy(dict, start, end);
      const bfs = runBfs(dict, start, end);
      assert.equal(greedy.found, bfs.found, `${start} -> ${end}: found`);
      if (bfs.found) {
        assert.ok(
          greedy.path.length >= bfs.path.length,
          `${start} -> ${end}: ${greedy.path.length} >= ${bfs.path.length}`,
        );
      }
    }
  }
});

test('GR-6: every discover scores the Hamming distance and no reparent is emitted', () => {
  for (const end of ['core', 'cord', 'card']) {
    const result = runGreedy(dict4, 'bolt', end);
    for (const event of result.events) {
      assert.notEqual(event.type, 'reparent');
      if (event.type === 'discover') {
        assert.equal(event.score, hammingDistance(event.word, end));
      }
    }
  }
});

test('GR-7: validateEvents passes for the GR-2 result and both fixtures', () => {
  const dict = fakeGreedyDictionary();
  const result = runGreedy(dict, 's', 't', { heuristic: greedyHeuristic() });
  assert.deepEqual(validateEvents(result, dict), { ok: true });
  for (const [d, words] of fixtures) {
    for (const [start, end] of orderedPairs(words)) {
      const validation = validateEvents(runGreedy(d, start, end), d);
      assert.equal(validation.ok, true, `${start} -> ${end}: ${validation.errors?.join('; ')}`);
    }
  }
});

test('GR-8: completes a 5,000-node chain', () => {
  const size = 5000;
  const words = Array.from({ length: size }, (_, i) => String(i).padStart(4, '0'));
  const wordSet = new Set(words);
  const edges = new Map(words.map((word, i) => {
    const neighbors = [];
    if (i > 0) neighbors.push(words[i - 1]);
    if (i + 1 < size) neighbors.push(words[i + 1]);
    return [word, neighbors];
  }));
  const dict = {
    has: (word) => wordSet.has(word),
    neighbors: (word) => edges.get(word) ?? [],
  };
  const result = runGreedy(dict, words[0], words[size - 1]);
  assert.equal(result.found, true);
  assert.equal(result.path.length, size);
});

test('GR-9: determinism', () => {
  assert.deepEqual(runGreedy(dict4, 'bolt', 'core'), runGreedy(dict4, 'bolt', 'core'));
});

function fakeGreedyDictionary() {
  const edges = {
    s: ['a', 'c'],
    a: ['b', 's'],
    b: ['a', 'd'],
    d: ['b', 't'],
    c: ['s', 't'],
    t: ['c', 'd'],
  };
  return {
    has: (word) => Object.prototype.hasOwnProperty.call(edges, word),
    neighbors: (word) => edges[word] ?? [],
  };
}

function greedyHeuristic() {
  const values = { s: 9, a: 1, b: 1, d: 1, c: 5, t: 0 };
  return (word) => values[word] ?? 0;
}
