import { SearchInputError } from './errors.js';

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
    algorithm: 'bfs',
    frontierMode: 'fifo',
    start,
    end,
    found,
    path,
    events,
    stats,
  };
}

/**
 * Spec 03 - Breadth-first search. Mark-on-discover, FIFO frontier, no reparent.
 */
export function runBfs(dict, start, end, { maxVisits = Infinity } = {}) {
  if (!dict.has(start)) {
    throw new SearchInputError('UNKNOWN_START', `Unknown start word: ${start}`);
  }
  if (!dict.has(end)) {
    throw new SearchInputError('UNKNOWN_END', `Unknown end word: ${end}`);
  }

  const events = [];
  const discovered = new Set();
  const parent = new Map();
  const depth = new Map();
  const queue = [];
  let head = 0;
  let visited = 0;

  discovered.add(start);
  parent.set(start, null);
  depth.set(start, 0);
  events.push({ type: 'discover', word: start, from: null, depth: 0 });
  queue.push(start);

  while (head < queue.length) {
    if (visited >= maxVisits) {
      events.push({ type: 'fail', reason: 'limit' });
      return makeResult(start, end, false, null, events, {
        discovered: discovered.size,
        visited,
        pathLength: 0,
      });
    }

    const current = queue[head++];
    visited++;
    events.push({ type: 'visit', word: current });

    if (current === end) {
      const path = reconstructPath(parent, start, end);
      events.push({ type: 'path', words: path });
      return makeResult(start, end, true, path, events, {
        discovered: discovered.size,
        visited,
        pathLength: path.length - 1,
      });
    }

    const childDepth = depth.get(current) + 1;
    for (const neighbor of dict.neighbors(current)) {
      if (discovered.has(neighbor)) continue;
      discovered.add(neighbor);
      parent.set(neighbor, current);
      depth.set(neighbor, childDepth);
      events.push({ type: 'discover', word: neighbor, from: current, depth: childDepth });
      queue.push(neighbor);
    }
  }

  events.push({ type: 'fail', reason: 'unreachable' });
  return makeResult(start, end, false, null, events, {
    discovered: discovered.size,
    visited,
    pathLength: 0,
  });
}
