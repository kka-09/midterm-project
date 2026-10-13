import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInput } from '../src/data.js';
import { runBfs } from '../src/search/bfs.js';
import {
  formatValidationMessage,
  speedLabel,
  frontierLabel,
  summaryText,
} from '../src/ui/format.js';
import { encodeHash, decodeHash } from '../src/ui/hash.js';
import { SPEED_STOPS, DEFAULT_SPEED } from '../src/config.js';
import { loadFixture } from './helpers/fixtures.js';

const dict4 = loadFixture(4);
const dict3 = loadFixture(3);

test('UI-1: every validation code formats to the spec 01 message', () => {
  const cases = [
    ['EMPTY', ''],
    ['INVALID_CHARS', 'a1'],
    ['LENGTH_MISMATCH', 'ab'],
    ['UNSUPPORTED_LENGTH', 'ab'],
    ['WRONG_DICTIONARY', 'cold'],
    ['UNKNOWN_START', 'xxxx'],
    ['UNKNOWN_END', 'xxxx'],
  ];
  for (const [code, word] of cases) {
    let result;
    if (code === 'EMPTY') result = validateInput(dict4, '', 'warm');
    else if (code === 'INVALID_CHARS') result = validateInput(dict4, 'a1', 'warm');
    else if (code === 'LENGTH_MISMATCH') result = validateInput(dict4, 'ab', 'warm');
    else if (code === 'UNSUPPORTED_LENGTH') result = validateInput(null, 'ab', 'cd');
    else if (code === 'WRONG_DICTIONARY') result = validateInput(dict3, 'cold', 'warm');
    else if (code === 'UNKNOWN_START') result = validateInput(dict4, 'xxxx', 'core');
    else result = validateInput(dict4, 'core', 'xxxx');

    assert.equal(result.code, code, `expected ${code}, got ${result.code}`);
    const ctx = { length: 2, word: code === 'UNKNOWN_START' ? 'xxxx' : 'xxxx' };
    if (code === 'WRONG_DICTIONARY') {
      assert.equal(formatValidationMessage(code), result.message);
    } else if (code === 'UNSUPPORTED_LENGTH') {
      assert.equal(formatValidationMessage(code, { length: 2 }), result.message);
    } else if (code === 'UNKNOWN_START' || code === 'UNKNOWN_END') {
      assert.equal(formatValidationMessage(code, { word: 'xxxx' }), result.message);
    } else {
      assert.equal(formatValidationMessage(code, ctx), result.message);
    }
  }
});

test('UI-2: hash round-trips and tolerates junk', () => {
  const inputs = [
    { start: 'cold', end: 'warm', algo: 'bfs' },
    { start: 'cat', end: 'dog', algo: 'astar' },
    { start: 'makan', end: 'rumah', algo: 'greedy' },
  ];
  for (const input of inputs) {
    const round = decodeHash(encodeHash(input));
    assert.deepEqual(round, input);
    assert.deepEqual(decodeHash(`#${encodeHash(input)}`), input);
  }
  assert.deepEqual(decodeHash(''), { start: '', end: '', algo: 'bfs' });
  assert.deepEqual(decodeHash('#'), { start: '', end: '', algo: 'bfs' });
  assert.deepEqual(decodeHash('#start=&end=&algo='), { start: '', end: '', algo: 'bfs' });
  assert.deepEqual(decodeHash('#algo=turbo&other=1'), { start: '', end: '', algo: 'bfs' });
  assert.deepEqual(decodeHash(encodeHash({ start: 'cat', end: 'dog', algo: 'turbo' })), {
    start: 'cat',
    end: 'dog',
    algo: 'bfs',
  });
  assert.doesNotThrow(() => decodeHash(null));
});

test('UI-3: speed stops and label map to the configured values', () => {
  assert.deepEqual(SPEED_STOPS, [1, 2, 4, 8, 16, 32, 64]);
  assert.equal(DEFAULT_SPEED, 4);
  assert.deepEqual(SPEED_STOPS.map(speedLabel), ['1/s', '2/s', '4/s', '8/s', '16/s', '32/s', '64/s']);
});

test('UI-4: summary text for found, unreachable, and limit', () => {
  const found = runBfs(dict4, 'bolt', 'core');
  assert.equal(summaryText(found), 'Found a ladder of 5 words after 7 visits.');

  const single = runBfs(dict4, 'bolt', 'bolt');
  assert.equal(summaryText(single), 'Found a ladder of 1 words after 1 visit.');

  const unreachable = runBfs(dict4, 'bolt', 'quiz');
  assert.equal(summaryText(unreachable), 'No ladder exists between these words.');

  const limit = { found: false, stats: { visited: 1 }, events: [{ type: 'fail', reason: 'limit' }] };
  assert.equal(summaryText(limit), 'Stopped after 1 visit without finding a ladder.');

  const limitMany = { found: false, stats: { visited: 12 }, events: [{ type: 'fail', reason: 'limit' }] };
  assert.equal(summaryText(limitMany), 'Stopped after 12 visits without finding a ladder.');
});

test('UI-5: frontier labels follow the algorithm mode', () => {
  assert.equal(frontierLabel('fifo'), 'Queue');
  assert.equal(frontierLabel('priority-h'), 'Priority list');
  assert.equal(frontierLabel('priority-f'), 'Priority list');
});
