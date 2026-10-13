import { test } from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import { createRenderer } from '../src/renderer.js';
import { createReplay } from '../src/replay.js';
import { runBfs } from '../src/search/bfs.js';
import { loadFixture } from './helpers/fixtures.js';

const dict4 = loadFixture(4);

function build(options = {}) {
  return createRenderer(null, { cytoscape, headless: true, start: 'a', end: 'z', ...options });
}

function forward(renderer, events) {
  renderer.apply({ kind: 'forward', events });
}

function classesOf(renderer, id) {
  const node = renderer.elements().nodes.find((entry) => entry.id === id);
  return node ? node.classes : null;
}

function edgeBetween(renderer, source, target) {
  return renderer.elements().edges.find((edge) => edge.source === source && edge.target === target) ?? null;
}

test('RN-1: discover adds a node and an edge with start/frontier classes', () => {
  const renderer = build({ start: 'bolt', end: 'core' });
  forward(renderer, [
    { type: 'discover', word: 'bolt', from: null, depth: 0 },
    { type: 'discover', word: 'bold', from: 'bolt', depth: 1 },
  ]);
  const { nodes, edges } = renderer.elements();
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  assert.deepEqual(edgeBetween(renderer, 'bolt', 'bold'), { source: 'bolt', target: 'bold', classes: [] });
  assert.ok(classesOf(renderer, 'bolt').includes('start'));
  assert.ok(classesOf(renderer, 'bold').includes('frontier'));
});

test('RN-2: visit moves the current marker and marks the previous node visited', () => {
  const renderer = build({ start: 'bolt', end: 'core' });
  forward(renderer, [
    { type: 'discover', word: 'bolt', from: null, depth: 0 },
    { type: 'visit', word: 'bolt' },
  ]);
  assert.ok(classesOf(renderer, 'bolt').includes('current'));

  forward(renderer, [
    { type: 'discover', word: 'bold', from: 'bolt', depth: 1 },
    { type: 'visit', word: 'bold' },
  ]);
  const bolt = classesOf(renderer, 'bolt');
  const bold = classesOf(renderer, 'bold');
  assert.ok(bolt.includes('visited'));
  assert.ok(!bolt.includes('current'));
  assert.ok(bold.includes('current'));
  assert.ok(!bold.includes('frontier'));
});

test('RN-3: the end word is marked end as soon as it is drawn', () => {
  const renderer = build({ start: 'bolt', end: 'core' });
  forward(renderer, [{ type: 'discover', word: 'core', from: 'cord', depth: 2 }]);
  assert.ok(classesOf(renderer, 'core').includes('end'));
});

test('RN-4: nodeCap hides words beyond the cap', () => {
  const renderer = build({ nodeCap: 3 });
  forward(renderer, [
    { type: 'discover', word: 'a', from: null, depth: 0 },
    { type: 'discover', word: 'b', from: 'a', depth: 1 },
    { type: 'discover', word: 'c', from: 'a', depth: 1 },
    { type: 'discover', word: 'd', from: 'b', depth: 2 },
  ]);
  const counts = renderer.counts();
  assert.equal(counts.rendered, 3);
  assert.equal(counts.hidden, 1);
  assert.equal(renderer.elements().nodes.length, 3);
});

test('RN-5: a path adds missing nodes beyond nodeCap and dims everything else', () => {
  const renderer = build({ nodeCap: 3, start: 'a', end: 'd' });
  forward(renderer, [
    { type: 'discover', word: 'a', from: null, depth: 0 },
    { type: 'visit', word: 'a' },
    { type: 'discover', word: 'b', from: 'a', depth: 1 },
    { type: 'visit', word: 'b' },
    { type: 'discover', word: 'c', from: 'b', depth: 2 },
    { type: 'visit', word: 'c' },
    { type: 'discover', word: 'd', from: 'b', depth: 2 },
    { type: 'visit', word: 'd' },
    { type: 'path', words: ['a', 'b', 'd'] },
  ]);
  const counts = renderer.counts();
  assert.equal(counts.pathDrawn, true);
  assert.ok(renderer.elements().nodes.length > 3);
  assert.ok(classesOf(renderer, 'd').includes('path'));
  assert.ok(classesOf(renderer, 'a').includes('path'));
  assert.ok(classesOf(renderer, 'c').includes('dim'));
  assert.ok(edgeBetween(renderer, 'b', 'd').classes.includes('path'));
  assert.ok(edgeBetween(renderer, 'b', 'c').classes.includes('dim'));
});

test('RN-6: an impossible path sets pathDrawn false and draws nothing extra', () => {
  const renderer = build({ nodeCap: 2, hardCap: 3, start: 'a', end: 'd' });
  forward(renderer, [
    { type: 'discover', word: 'a', from: null, depth: 0 },
    { type: 'discover', word: 'b', from: 'a', depth: 1 },
    { type: 'discover', word: 'c', from: 'b', depth: 2 },
    { type: 'discover', word: 'd', from: 'c', depth: 3 },
    { type: 'path', words: ['a', 'b', 'c', 'd'] },
  ]);
  assert.equal(renderer.counts().pathDrawn, false);
  assert.equal(renderer.counts().rendered, 2);
  assert.equal(renderer.elements().nodes.length, 2);
});

test('RN-7: reparent swaps the edge without changing the node count', () => {
  const renderer = build();
  forward(renderer, [
    { type: 'discover', word: 'a', from: null, depth: 0 },
    { type: 'discover', word: 'b', from: 'a', depth: 1 },
    { type: 'discover', word: 'c', from: 'a', depth: 1 },
  ]);
  assert.ok(edgeBetween(renderer, 'a', 'c'));

  forward(renderer, [
    { type: 'reparent', word: 'c', from: 'b', depth: 2, prevFrom: 'a', prevDepth: 1 },
  ]);
  assert.equal(edgeBetween(renderer, 'a', 'c'), null);
  assert.ok(edgeBetween(renderer, 'b', 'c'));
  assert.equal(renderer.elements().nodes.length, 3);
});

test('RN-8: forward then backward to 0 empties the graph; partial rebuilds match', () => {
  const result = runBfs(dict4, 'bolt', 'core');
  const renderer = build({ start: 'bolt', end: 'core' });
  const replay = createReplay(result);
  replay.subscribe((change) => renderer.apply(change, replay.state));

  for (let i = 0; i < replay.total; i++) replay.step();
  const full = renderer.elements();
  assert.ok(full.nodes.length > 0);

  for (let i = 0; i < replay.total; i++) replay.back();
  assert.deepEqual(renderer.elements(), { nodes: [], edges: [] });

  const partial = 8;
  const stepped = build({ start: 'bolt', end: 'core' });
  const steppedReplay = createReplay(result);
  steppedReplay.subscribe((change) => stepped.apply(change, steppedReplay.state));
  for (let i = 0; i < partial; i++) steppedReplay.step();

  const rebuilt = build({ start: 'bolt', end: 'core' });
  const rebuiltReplay = createReplay(result);
  rebuiltReplay.subscribe((change) => rebuilt.apply(change, rebuiltReplay.state));
  rebuiltReplay.seek(partial);

  assert.deepEqual(rebuilt.elements(), stepped.elements());
});

test('RN-9: a reset rebuild matches incremental application', () => {
  const result = runBfs(dict4, 'bolt', 'core');
  const incremental = build({ start: 'bolt', end: 'core' });
  const replayA = createReplay(result);
  replayA.subscribe((change) => incremental.apply(change, replayA.state));
  replayA.seek(12);

  const rebuilt = build({ start: 'bolt', end: 'core' });
  const replayB = createReplay(result);
  replayB.subscribe((change) => rebuilt.apply(change, replayB.state));
  replayB.seek(4);
  replayB.seek(12);

  assert.deepEqual(rebuilt.elements(), incremental.elements());
});

test('RN-10: destroy drops the graph and later applies are inert', () => {
  const renderer = build();
  forward(renderer, [{ type: 'discover', word: 'a', from: null, depth: 0 }]);
  renderer.destroy();
  assert.deepEqual(renderer.elements(), { nodes: [], edges: [] });
  assert.doesNotThrow(() => forward(renderer, [{ type: 'discover', word: 'b', from: 'a', depth: 1 }]));
  assert.deepEqual(renderer.elements(), { nodes: [], edges: [] });
});
