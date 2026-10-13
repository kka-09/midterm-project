import { hammingDistance } from './heuristics.js';
import { MinHeap } from './heap.js';
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
    algorithm: 'astar',
    frontierMode: 'priority-f',
    start,
    end,
    found,
    path,
    events,
    stats,
  };
}

/**
 * Spec 05 - A* search. Priority key: (score, score - depth, seq) ascending.
 * `dict` only needs has/neighbors (D9). `heuristic` is for tests only.
 */
export function runAstar(dict, start, end, { maxVisits = Infinity, heuristic = hammingDistance } = {}) {
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
  const hScore = new Map();
  const fScore = new Map();
  let visited = 0;
  let seq = 0;

  const frontier = new MinHeap((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aTie = a.score - a.depth;
    const bTie = b.score - b.depth;
    if (aTie !== bTie) return aTie - bTie;
    return a.seq - b.seq;
  });

  const startH = heuristic(start, end);
  discovered.add(start);
  parent.set(start, null);
  depth.set(start, 0);
  hScore.set(start, startH);
  fScore.set(start, startH);
  events.push({ type: 'discover', word: start, from: null, depth: 0, score: startH });
  frontier.push({ word: start, score: startH, depth: 0, seq: seq++ });

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

    const from = current.word;
    const childDepth = depth.get(from) + 1;
    for (const neighbor of dict.neighbors(from)) {
      if (closed.has(neighbor)) continue;
      if (!discovered.has(neighbor)) {
        discovered.add(neighbor);
        const h = heuristic(neighbor, end);
        parent.set(neighbor, from);
        depth.set(neighbor, childDepth);
        hScore.set(neighbor, h);
        fScore.set(neighbor, childDepth + h);
        events.push({
          type: 'discover',
          word: neighbor,
          from,
          depth: childDepth,
          score: childDepth + h,
        });
        frontier.push({ word: neighbor, score: childDepth + h, depth: childDepth, seq: seq++ });
      } else if (childDepth < depth.get(neighbor)) {
        const prevFrom = parent.get(neighbor);
        const prevDepth = depth.get(neighbor);
        const prevScore = fScore.get(neighbor);
        const h = hScore.get(neighbor);
        parent.set(neighbor, from);
        depth.set(neighbor, childDepth);
        fScore.set(neighbor, childDepth + h);
        events.push({
          type: 'reparent',
          word: neighbor,
          from,
          depth: childDepth,
          score: childDepth + h,
          prevFrom,
          prevDepth,
          prevScore,
        });
        frontier.update(
          (item) => item.word === neighbor,
          { word: neighbor, score: childDepth + h, depth: childDepth, seq: seq++ },
        );
      }
    }
  }

  events.push({ type: 'fail', reason: 'unreachable' });
  return makeResult(start, end, false, null, events, {
    discovered: discovered.size,
    visited,
    pathLength: 0,
  });
}
