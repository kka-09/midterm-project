import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRadialLayout } from '../src/layout.js';

function distance(position) {
  return Math.hypot(position.x, position.y);
}

test('LY-1: identical discovery sequences give identical positions', () => {
  const sequence = [
    ['s', null],
    ['a', 's'],
    ['b', 's'],
    ['c', 'a'],
    ['d', 'a'],
    ['e', 'b'],
    ['f', 'b'],
    ['g', 'c'],
  ];
  const first = createRadialLayout({ ringGap: 50 });
  const second = createRadialLayout({ ringGap: 50 });
  for (const [word, parent] of sequence) {
    first.place(word, parent);
    second.place(word, parent);
  }
  for (const [word] of sequence) {
    assert.deepEqual(first.positionOf(word), second.positionOf(word), word);
  }
});

test('LY-2: every word sits at depth * ringGap from the origin', () => {
  const ringGap = 56;
  const layout = createRadialLayout({ ringGap });
  const depths = new Map();
  const sequence = [
    ['s', null],
    ['a', 's'],
    ['b', 's'],
    ['c', 'a'],
    ['d', 'a'],
    ['e', 'b'],
    ['f', 'c'],
    ['g', 'f'],
  ];
  for (const [word, parent] of sequence) {
    layout.place(word, parent);
    depths.set(word, parent === null ? 0 : depths.get(parent) + 1);
    const expected = depths.get(word) * ringGap;
    assert.ok(Math.abs(distance(layout.positionOf(word)) - expected) < 1e-6, `${word}: ${expected}`);
  }
});

test('LY-3: positionOf never changes after place', () => {
  const layout = createRadialLayout();
  const first = layout.place('a', null);
  const again = layout.place('a', 'other');
  assert.equal(again, first);
  assert.deepEqual(layout.positionOf('a'), first);
});

test('LY-4: 500 sequential placements never collide', () => {
  const layout = createRadialLayout();
  layout.place('n0', null);
  const words = ['n0'];
  for (let i = 1; i < 500; i++) {
    const word = `n${i}`;
    const parent = `n${Math.floor((i - 1) / 3)}`;
    layout.place(word, parent);
    words.push(word);
  }
  const seen = new Set();
  for (const word of words) {
    const position = layout.positionOf(word);
    const key = `${position.x},${position.y}`;
    assert.equal(seen.has(key), false, `${word} collides at ${key}`);
    seen.add(key);
  }
});
