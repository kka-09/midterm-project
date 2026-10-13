import { hammingDistance } from './heuristics.js';
import { SearchInputError } from './errors.js';
import { MinHeap } from './heap.js';

function reconstructPath(parent, start, end) {
  const words = [];
  let cursor = end;
  while (cursor !== undefined && cursor !== null) {
    words.push(cursor);
    if (cursor === start) break;
    cursor = parent.get(cursor);
  }
  words.reverse();
  return words;
}

function makeResult(start, end, found, path, events, stats) {
  return {
    algorithm: 'greedy',
    frontierMode: 'priority-h',
    start,
    end,
    found,
    path,
    events,
    stats,
  };
}

/**
 * Spec 04 - Greedy best-first. Priority key `(score, seq)`, mark-on-discover,
 * no reparent. `heuristic` is for tests only.
 */
export function runGreedy(dict, start, end, { maxVisits = Infinity, heuristic = hammingDistance } = {}) {
  if (!dict.has(start)) {
    throw new SearchInputError('UNKNOWN_START', `Unknown start word: ${start}`);
  }
  if (!dict.has(end)) {
    throw new SearchInputError('UNKNOWN_END', `Unknown end word: ${end}`);
  }
  if (typeof heuristic !== 'function') {
    throw new TypeError('heuristic must be a function');
  }

  const events = [];
  const discovered = new Set();
  const closed = new Set();
  const parent = new Map();
  const depth = new Map();
  let visited = 0;
  let seq = 0;

  const frontier = new MinHeap((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.seq - b.seq;
  });

  const startScore = heuristic(start, end);
  discovered.add(start);
  parent.set(start, null);
  depth.set(start, 0);
  events.push({ type: 'discover', word: start, from: null, depth: 0, score: startScore });
  frontier.push({ word: start, score: startScore, seq: seq++ });

  while (frontier.size > 0) {
    if (visited >= maxVisits) {
      events.push({ type: 'fail', reason: 'limit' });
      return makeResult(start, end, false, null, events, {
        discovered: discovered.size,
        visited,
        pathLength: 0,
      });
    }

    const current = frontier.pop();
    if (closed.has(current.word)) continue;
    closed.add(current.word);
    visited++;
    events.push({ type: 'visit', word: current.word });

    if (current.word === end) {
      const path = reconstructPath(parent, start, end);
      events.push({ type: 'path', words: path });
      return makeResult(start, end, true, path, events, {
        discovered: discovered.size,
        visited,
        pathLength: path.length,
      });
    }

    const childDepth = depth.get(current.word) + 1;
    for (const neighbor of dict.neighbors(current.word)) {
      if (discovered.has(neighbor)) continue;
      discovered.add(neighbor);
      parent.set(neighbor, current.word);
      depth.set(neighbor, childDepth);
      const score = heuristic(neighbor, end);
      events.push({ type: 'discover', word: neighbor, from: current.word, depth: childDepth, score });
      frontier.push({ word: neighbor, score, seq: seq++ });
    }
  }

  events.push({ type: 'fail', reason: 'unreachable' });
  return makeResult(start, end, false, null, events, {
    discovered: discovered.size,
    visited,
    pathLength: 0,
  });
}
