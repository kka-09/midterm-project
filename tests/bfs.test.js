import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBfs } from '../src/search/bfs.js';
import { validateEvents } from '../src/events.js';
import { loadFixture } from './helpers/fixtures.js';

const dict4 = loadFixture(4);
const dict3 = loadFixture(3);

const fixtures = [
  [dict4, ['bold', 'bolt', 'card', 'cola', 'cold', 'cord', 'core', 'quiz']],
  [dict3, ['bat', 'cat', 'cog', 'cot', 'dog', 'dot']],
];

test('BFS-1: bolt -> core golden events', () => {
  const result = runBfs(dict4, 'bolt', 'core');
  const expected = [
    { type: 'discover', word: 'bolt', from: null, depth: 0 },
    { type: 'visit', word: 'bolt' },
    { type: 'discover', word: 'bold', from: 'bolt', depth: 1 },
    { type: 'visit', word: 'bold' },
    { type: 'discover', word: 'cold', from: 'bold', depth: 2 },
    { type: 'visit', word: 'cold' },
    { type: 'discover', word: 'cola', from: 'cold', depth: 3 },
    { type: 'discover', word: 'cord', from: 'cold', depth: 3 },
    { type: 'visit', word: 'cola' },
    { type: 'visit', word: 'cord' },
    { type: 'discover', word: 'card', from: 'cord', depth: 4 },
    { type: 'discover', word: 'core', from: 'cord', depth: 4 },
    { type: 'visit', word: 'card' },
    { type: 'visit', word: 'core' },
    { type: 'path', words: ['bolt', 'bold', 'cold', 'cord', 'core'] },
  ];
  assert.equal(result.events.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(result.events[i], expected[i], `event ${i + 1}`);
  }
  assert.deepEqual(result.stats, { discovered: 7, visited: 7, pathLength: 4 });
  assert.equal(result.found, true);
});

test('BFS-2: cat -> dog on the 3-letter fixture', () => {
  const result = runBfs(dict3, 'cat', 'dog');
  assert.deepEqual(result.path, ['cat', 'cot', 'cog', 'dog']);
  assert.deepEqual(result.stats, { discovered: 6, visited: 6, pathLength: 3 });
});

test('BFS-3: start === end returns [discover, visit, path]', () => {
  const result = runBfs(dict4, 'bolt', 'bolt');
  assert.deepEqual(result.events.map((event) => event.type), ['discover', 'visit', 'path']);
  assert.deepEqual(result.path, ['bolt']);
});

test('BFS-4: bolt -> quiz is unreachable', () => {
  const result = runBfs(dict4, 'bolt', 'quiz');
  assert.equal(result.found, false);
  assert.equal(result.path, null);
  assert.deepEqual(result.events.at(-1), { type: 'fail', reason: 'unreachable' });
});

test('BFS-5: picks the shortest of two routes on a fake dictionary', () => {
  const edges = {
    s: ['a', 'b'],
    a: ['s', 'x'],
    x: ['a', 't'],
    b: ['s', 't'],
    t: ['x', 'b'],
  };
  const dict = {
    has: (word) => Object.prototype.hasOwnProperty.call(edges, word),
    neighbors: (word) => edges[word] ?? [],
  };
  const result = runBfs(dict, 's', 't');
  assert.deepEqual(result.path, ['s', 'b', 't']);
});

test('BFS-6: validateEvents passes for every ordered pair in both fixtures', () => {
  for (const [dict, words] of fixtures) {
    for (const start of words) {
      for (const end of words) {
        const result = runBfs(dict, start, end);
        const validation = validateEvents(result, dict);
        assert.equal(validation.ok, true, `${start} -> ${end}: ${validation.errors?.join('; ')}`);
      }
    }
  }
});

test('BFS-7: visit depths are non-decreasing for every reachable pair', () => {
  for (const [dict, words] of fixtures) {
    for (const start of words) {
      for (const end of words) {
        const result = runBfs(dict, start, end);
        const depth = new Map([[start, 0]]);
        let last = -1;
        for (const event of result.events) {
          if (event.type === 'discover' && event.from !== null) {
            depth.set(event.word, depth.get(event.from) + 1);
          }
          if (event.type === 'visit') {
            const d = depth.get(event.word) ?? 0;
            assert.ok(d >= last, `${start} -> ${end}: depth went backwards`);
            last = d;
          }
        }
      }
    }
  }
});
