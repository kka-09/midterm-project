import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBfs } from '../src/search/bfs.js';
import { runGreedy } from '../src/search/greedy.js';
import { runAstar } from '../src/search/astar.js';
import { createReplay } from '../src/replay.js';
import { loadFixture } from './helpers/fixtures.js';
import { snapshot, createFakeScheduler } from './helpers/snapshot.js';

const dict4 = loadFixture(4);

function bfsResult(start = 'bolt', end = 'core') {
  return runBfs(dict4, start, end);
}

function syntheticResult(eventCount) {
  const events = [];
  const pairs = Math.max(1, eventCount >> 1);
  for (let i = 0; i < pairs; i++) {
    const parent = i === 0 ? null : `w${i - 1}`;
    events.push({ type: 'discover', word: `w${i}`, from: parent, depth: i, score: 0 });
    events.push({ type: 'visit', word: `w${i}` });
  }
  events.push({ type: 'path', words: ['w0'] });
  return {
    algorithm: 'bfs',
    frontierMode: 'fifo',
    start: 'w0',
    end: `w${pairs - 1}`,
    found: true,
    path: ['w0'],
    events,
    stats: { discovered: pairs, visited: pairs, pathLength: 1 },
  };
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

test('RP-1: a new replay is empty, paused, at index 0', () => {
  const replay = createReplay(bfsResult());
  assert.equal(replay.index, 0);
  assert.equal(replay.playing, false);
  assert.equal(replay.index, 0);
  assert.equal(replay.state.current, null);
  assert.equal(replay.state.discovered, 0);
  assert.equal(replay.state.visited, 0);
  assert.equal(replay.state.frontierSize, 0);
  assert.equal(replay.state.pathWords, null);
  assert.equal(replay.state.failure, null);
  assert.equal(replay.state.atEnd, false);
  assert.deepEqual(replay.state.frontierPreview(5), []);
  assert.equal(replay.state.statusOf('bolt'), 'unseen');
});

test('RP-2: step reveals the frontier in order', () => {
  const replay = createReplay(bfsResult());
  for (let i = 0; i < 7; i++) replay.step();
  assert.equal(replay.state.current, 'cold');
  assert.equal(replay.state.statusOf('cola'), 'frontier');
  assert.equal(replay.state.statusOf('cold'), 'visited');
  assert.deepEqual(replay.state.frontierPreview(5), ['cola']);
  replay.step();
  assert.deepEqual(replay.state.frontierPreview(5), ['cola', 'cord']);
});

test('RP-3: step at the end and back at 0 are no-ops that emit nothing', () => {
  const replay = createReplay(bfsResult());
  const kinds = [];
  replay.subscribe((change) => kinds.push(change.kind));
  replay.back();
  assert.deepEqual(kinds, []);
  replay.seek(replay.total);
  kinds.length = 0;
  replay.step();
  assert.deepEqual(kinds, []);
});

test('RP-4: step then back restores the exact state at every index', () => {
  const result = bfsResult();
  for (let i = 0; i < result.events.length; i++) {
    const replay = createReplay(result);
    replay.seek(i);
    const before = snapshot(replay.state);
    replay.step();
    replay.back();
    assert.deepEqual(snapshot(replay.state), before, `index ${i}`);
  }
});

test('RP-5: seek(n) equals stepping n times from a fresh replay', () => {
  const result = bfsResult();
  for (let n = 0; n <= result.events.length; n++) {
    const stepped = createReplay(result);
    for (let i = 0; i < n; i++) stepped.step();
    const seeked = createReplay(result);
    seeked.seek(n);
    assert.equal(seeked.index, n);
    assert.deepEqual(snapshot(seeked.state), snapshot(stepped.state), `n ${n}`);
  }
});

test('RP-6: seek clamps and emits exactly one reset', () => {
  const result = bfsResult();
  const replay = createReplay(result);
  let resets = 0;
  replay.subscribe((change) => {
    if (change.kind === 'reset') resets++;
  });
  replay.seek(-3);
  assert.equal(replay.index, 0);
  assert.equal(resets, 1);
  replay.seek(1e9);
  assert.equal(replay.index, result.events.length);
  assert.equal(resets, 2);
});

test('RP-7: reparent undo restores the parent and depth', () => {
  const replay = createReplay(as7Result());
  replay.seek(10);
  assert.equal(replay.state.parentOf('x'), 'c');
  assert.equal(replay.state.depthOf('x'), 2);
  replay.back();
  assert.equal(replay.state.parentOf('x'), 'b');
  assert.equal(replay.state.depthOf('x'), 3);
});

test('RP-8: path and failure are set at the end and cleared by back', () => {
  const found = bfsResult();
  const replay = createReplay(found);
  replay.seek(replay.total);
  assert.deepEqual(replay.state.pathWords, found.path);
  replay.back();
  assert.equal(replay.state.pathWords, null);

  const failed = bfsResult('bolt', 'quiz');
  const failing = createReplay(failed);
  failing.seek(failing.total);
  assert.deepEqual(failing.state.failure, { reason: 'unreachable' });
  failing.back();
  assert.equal(failing.state.failure, null);
});

test('RP-9: frontier orders follow the algorithm key', () => {
  const greedy = createReplay(runGreedy(dict4, 'bolt', 'core'));
  greedy.seek(8);
  assert.deepEqual(greedy.state.frontierPreview(5), ['cord', 'cola']);

  const tie = createReplay({
    algorithm: 'greedy',
    frontierMode: 'priority-h',
    start: 's',
    end: 't',
    found: false,
    path: null,
    events: [
      { type: 'discover', word: 's', from: null, depth: 0, score: 2 },
      { type: 'visit', word: 's' },
      { type: 'discover', word: 'cola', from: 's', depth: 1, score: 2 },
      { type: 'discover', word: 'cord', from: 's', depth: 1, score: 2 },
    ],
    stats: { discovered: 3, visited: 1, pathLength: 0 },
  });
  tie.seek(4);
  assert.deepEqual(tie.state.frontierPreview(5), ['cola', 'cord']);

  const astar = createReplay(as7Result());
  astar.seek(9);
  assert.deepEqual(astar.state.frontierPreview(5), ['x']);
  astar.seek(8);
  assert.deepEqual(astar.state.frontierPreview(5), ['c', 'x']);
});

test('RP-10: playback applies events from elapsed time and caps each batch', () => {
  const clock = createFakeScheduler();
  const replay = createReplay(syntheticResult(200), { scheduler: clock.scheduler });
  const batches = [];
  replay.subscribe((change) => {
    if (change.kind === 'forward') batches.push(change.events.length);
  });
  replay.play();
  clock.advance(1000);
  assert.equal(replay.index, 4);

  const clock2 = createFakeScheduler();
  const replay2 = createReplay(syntheticResult(200), { scheduler: clock2.scheduler });
  const batches2 = [];
  replay2.subscribe((change) => {
    if (change.kind === 'forward') batches2.push(change.events.length);
  });
  replay2.play();
  clock2.advance(10000);
  assert.ok(batches2.length >= 1);
  assert.ok(Math.max(...batches2) <= 24, `batches: ${batches2.join(',')}`);
});

test('RP-11: a clock jump applies at most one batch and does not catch up later', () => {
  const clock = createFakeScheduler();
  const replay = createReplay(syntheticResult(200), { scheduler: clock.scheduler });
  replay.play();
  clock.advance(60000);
  assert.equal(replay.index, 24);
  clock.advance(1000);
  assert.equal(replay.index, 28);
});

test('RP-12: playback pauses at the end and announces status', () => {
  const clock = createFakeScheduler();
  const result = bfsResult();
  const replay = createReplay(result, { scheduler: clock.scheduler });
  const statuses = [];
  replay.subscribe((change) => {
    if (change.kind === 'status') statuses.push(change.playing);
  });
  replay.play();
  for (let i = 0; i < 20 && replay.index < replay.total; i++) clock.advance(1000);
  assert.equal(replay.index, replay.total);
  assert.equal(replay.playing, false);
  assert.equal(statuses[statuses.length - 1], false);
});

test('RP-13: back pauses playback and toggle flips playing', () => {
  const clock = createFakeScheduler();
  const replay = createReplay(syntheticResult(50), { scheduler: clock.scheduler });
  replay.play();
  clock.advance(1000);
  assert.equal(replay.playing, true);
  replay.back();
  assert.equal(replay.playing, false);
  replay.toggle();
  assert.equal(replay.playing, true);
  replay.toggle();
  assert.equal(replay.playing, false);
});

test('RP-14: destroy cancels pending work and unsubscribes', () => {
  const clock = createFakeScheduler();
  const replay = createReplay(syntheticResult(200), { scheduler: clock.scheduler });
  let calls = 0;
  const unsubscribe = replay.subscribe(() => calls++);
  replay.play();
  const callsAfterPlay = calls;
  const before = replay.index;
  replay.destroy();
  clock.advance(1000);
  assert.equal(replay.index, before);
  assert.equal(calls, callsAfterPlay);
  assert.equal(clock.pending(), 0);
  unsubscribe();

  const replay2 = createReplay(syntheticResult(20), { scheduler: createFakeScheduler().scheduler });
  let hits = 0;
  const off = replay2.subscribe(() => hits++);
  replay2.step();
  off();
  replay2.step();
  assert.equal(hits, 1);
});

test('RP-15: setSpeed clamps to [0.5, 240]', () => {
  const replay = createReplay(bfsResult());
  replay.setSpeed(0);
  assert.equal(replay.speed, 0.5);
  replay.setSpeed(1e6);
  assert.equal(replay.speed, 240);
  replay.setSpeed(8);
  assert.equal(replay.speed, 8);
});

test('RP-16: forEachDiscovered reports discovery order and status', () => {
  const replay = createReplay(bfsResult());
  replay.seek(9);
  const seen = [];
  replay.state.forEachDiscovered((word, parent, depth, status) => {
    seen.push(word);
    assert.equal(status, replay.state.statusOf(word));
    assert.equal(depth, replay.state.depthOf(word));
    if (parent !== null) assert.equal(replay.state.statusOf(parent) !== 'unseen', true);
  });
  assert.deepEqual(seen, ['bolt', 'bold', 'cold', 'cola', 'cord']);
});
