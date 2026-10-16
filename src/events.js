import { algorithms } from './search/index.js';

const EVENT_TYPES = new Set(['discover', 'reparent', 'visit', 'path', 'fail']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Spec 02 - Event contract validator. Collects every error rather than
 * stopping at the first one.
 */
export function validateEvents(result, dict, { maxVisits = Infinity } = {}) {
  const errors = [];
  const fail = (rule, message) => errors.push(`${rule}: ${message}`);

  // --- V1: shape and JSON round-trip ---
  if (!isPlainObject(result)) {
    return { ok: false, errors: ['V1: result must be an object'] };
  }
  try {
    const roundTripped = JSON.parse(JSON.stringify(result));
    if (JSON.stringify(roundTripped) !== JSON.stringify(result)) {
      fail('V1', 'result must be deep-equal after a JSON round-trip');
    }
  } catch {
    fail('V1', 'result must be JSON-serializable');
  }
  for (const field of ['algorithm', 'frontierMode', 'start', 'end', 'found', 'path', 'events', 'stats']) {
    if (!(field in result)) fail('V1', `missing required field "${field}"`);
  }
  if (typeof result.found !== 'boolean') fail('V1', 'found must be a boolean');
  if (!Array.isArray(result.events)) fail('V1', 'events must be an array');
  if (result.path !== null && !Array.isArray(result.path)) fail('V1', 'path must be an array or null');
  if (!isPlainObject(result.stats)) {
    fail('V1', 'stats must be an object');
  } else {
    for (const field of ['discovered', 'visited', 'pathLength']) {
      if (typeof result.stats[field] !== 'number') fail('V1', `stats.${field} must be a number`);
    }
  }
  if (typeof result.start !== 'string') fail('V1', 'start must be a string');
  if (typeof result.end !== 'string') fail('V1', 'end must be a string');

  const events = Array.isArray(result.events) ? result.events : [];

  // --- V11: algorithm registry ---
  if (!Object.prototype.hasOwnProperty.call(algorithms, result.algorithm)) {
    fail('V11', `unknown algorithm "${result.algorithm}"`);
  } else if (result.frontierMode !== algorithms[result.algorithm].frontierMode) {
    fail('V11', `frontierMode must be "${algorithms[result.algorithm].frontierMode}"`);
  }

  // --- V2: first two events ---
  if (events.length < 2) {
    fail('V2', 'need at least a discover and a visit of start');
  } else {
    const first = events[0];
    if (
      !isPlainObject(first) ||
      first.type !== 'discover' ||
      first.word !== result.start ||
      first.from !== null ||
      first.depth !== 0
    ) {
      fail('V2', 'event 1 must be discover(start, from:null, depth:0)');
    }
    const second = events[1];
    if (!isPlainObject(second) || second.type !== 'visit' || second.word !== result.start) {
      fail('V2', 'event 2 must be visit(start)');
    }
  }

  // --- V3: field presence/types ---
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!isPlainObject(event) || !EVENT_TYPES.has(event.type)) {
      fail('V3', `event ${i + 1} has an unknown type`);
      continue;
    }
    if (event.type === 'discover') {
      if (typeof event.word !== 'string') fail('V3', `discover ${i + 1}: word must be a string`);
      if (event.from !== null && typeof event.from !== 'string') {
        fail('V3', `discover ${i + 1}: from must be a string or null`);
      }
      if (typeof event.depth !== 'number') fail('V3', `discover ${i + 1}: depth must be a number`);
    } else if (event.type === 'reparent') {
      if (typeof event.word !== 'string') fail('V3', `reparent ${i + 1}: word must be a string`);
      if (typeof event.from !== 'string') fail('V3', `reparent ${i + 1}: from must be a string`);
      if (typeof event.depth !== 'number') fail('V3', `reparent ${i + 1}: depth must be a number`);
      if (typeof event.prevFrom !== 'string') fail('V3', `reparent ${i + 1}: prevFrom must be a string`);
      if (typeof event.prevDepth !== 'number') fail('V3', `reparent ${i + 1}: prevDepth must be a number`);
      if (event.prevScore !== undefined && typeof event.prevScore !== 'number') {
        fail('V3', `reparent ${i + 1}: prevScore must be a number`);
      }
    } else if (event.type === 'visit') {
      if (typeof event.word !== 'string') fail('V3', `visit ${i + 1}: word must be a string`);
    } else if (event.type === 'path') {
      if (!Array.isArray(event.words)) fail('V3', `path ${i + 1}: words must be an array`);
    } else if (event.type === 'fail') {
      if (event.reason !== 'unreachable' && event.reason !== 'limit') {
        fail('V3', `fail ${i + 1}: reason must be "unreachable" or "limit"`);
      }
    }
  }

  // --- V12: score presence and reparent ownership ---
  const usesScore = result.algorithm === 'greedy' || result.algorithm === 'astar';
  const isAstar = result.algorithm === 'astar';
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!isPlainObject(event)) continue;
    if (event.type === 'discover' || event.type === 'reparent') {
      if (usesScore && typeof event.score !== 'number') {
        fail('V12', `${event.type} ${i + 1}: score is required for ${result.algorithm}`);
      }
      if (!usesScore && event.score !== undefined) {
        fail('V12', `${event.type} ${i + 1}: score must not be present for ${result.algorithm}`);
      }
    }
    if (event.type === 'reparent' && !isAstar) {
      fail('V12', `reparent ${i + 1}: only A* may emit reparent`);
    }
  }

  // --- Walk the events, enforcing V4-V10 ---
  const discovered = new Map(); // word -> { from, depth, score }
  const closed = new Set();
  const open = new Set();
  const visitEvents = [];
  let terminalIndex = -1;

  const adjacency = (from, word) => {
    try {
      return dict.neighbors(from).includes(word);
    } catch {
      return false;
    }
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!isPlainObject(event)) continue;

    if (event.type === 'discover') {
      if (discovered.has(event.word)) {
        fail('V4', `discover ${i + 1}: ${event.word} was already discovered`);
      } else if (event.from !== null) {
        if (!closed.has(event.from)) {
          fail('V4', `discover ${i + 1}: from ${event.from} has not been visited`);
        } else {
          const fromDepth = discovered.get(event.from)?.depth;
          if (event.depth !== fromDepth + 1) {
            fail('V4', `discover ${i + 1}: depth must equal depth(from) + 1`);
          }
          if (dict.has(event.from) && !adjacency(event.from, event.word)) {
            fail('V4', `discover ${i + 1}: ${event.word} is not a neighbor of ${event.from}`);
          }
        }
      }
      discovered.set(event.word, { from: event.from, depth: event.depth, score: event.score });
      open.add(event.word);
    } else if (event.type === 'reparent') {
      const entry = discovered.get(event.word);
      if (!entry) {
        fail('V5', `reparent ${i + 1}: ${event.word} was never discovered`);
      } else if (closed.has(event.word)) {
        fail('V5', `reparent ${i + 1}: ${event.word} has already been visited`);
      } else {
        if (!closed.has(event.from)) {
          fail('V5', `reparent ${i + 1}: from ${event.from} has not been visited`);
        } else {
          const fromDepth = discovered.get(event.from)?.depth;
          if (event.depth !== fromDepth + 1) {
            fail('V5', `reparent ${i + 1}: depth must equal depth(from) + 1`);
          }
          if (event.depth >= entry.depth) {
            fail('V5', `reparent ${i + 1}: new depth must be strictly smaller`);
          }
          if (dict.has(event.from) && !adjacency(event.from, event.word)) {
            fail('V5', `reparent ${i + 1}: ${event.word} is not a neighbor of ${event.from}`);
          }
        }
        if (event.prevFrom !== entry.from) fail('V5', `reparent ${i + 1}: prevFrom mismatch`);
        if (event.prevDepth !== entry.depth) fail('V5', `reparent ${i + 1}: prevDepth mismatch`);
        if (usesScore && event.prevScore !== entry.score) {
          fail('V5', `reparent ${i + 1}: prevScore mismatch`);
        }
        entry.from = event.from;
        entry.depth = event.depth;
        entry.score = event.score;
      }
    } else if (event.type === 'visit') {
      const entry = discovered.get(event.word);
      if (!entry) {
        fail('V6', `visit ${i + 1}: ${event.word} was never discovered`);
      } else if (closed.has(event.word)) {
        fail('V6', `visit ${i + 1}: ${event.word} was already visited`);
      } else {
        closed.add(event.word);
        open.delete(event.word);
        visitEvents.push({ index: i, word: event.word });
      }
    } else if (event.type === 'path' || event.type === 'fail') {
      terminalIndex = i;
    }
  }

  // --- V7: exactly one terminal event, last ---
  const terminals = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (isPlainObject(event) && (event.type === 'path' || event.type === 'fail')) terminals.push(i);
  }
  if (terminals.length !== 1) {
    fail('V7', 'there must be exactly one terminal event');
  } else if (terminals[0] !== events.length - 1) {
    fail('V7', 'the terminal event must be last');
  }

  // --- V8 / V9: terminal event semantics ---
  if (result.found) {
    if (!events.some((e) => isPlainObject(e) && e.type === 'path')) {
      fail('V8', 'found result must end with a path event');
    } else {
      const endVisit = visitEvents.find((entry) => entry.word === result.end);
      if (!endVisit) {
        fail('V8', 'end must be visited');
      }
      const lastVisit = visitEvents[visitEvents.length - 1];
      if (endVisit && lastVisit && lastVisit.index !== endVisit.index) {
        fail('V8', 'nothing may be visited after end');
      }
      if (!Array.isArray(result.path)) {
        fail('V8', 'found result must have an array path');
      } else {
        validatePath(result.path, discovered, result, dict, fail);
      }
    }
  } else if (result.path !== null) {
    fail('V9', 'path must be null when not found');
  }

  // --- V9: fail reason specifics ---
  if (terminalIndex >= 0) {
    const terminal = events[terminalIndex];
    if (isPlainObject(terminal) && terminal.type === 'fail') {
      if (terminal.reason === 'unreachable' && open.size > 0) {
        fail('V9', 'unreachable requires an empty frontier');
      }
      if (terminal.reason === 'limit' && visitEvents.length < maxVisits) {
        fail('V9', 'limit requires visited >= maxVisits');
      }
    }
  }

  // --- V10: stats ---
  if (isPlainObject(result.stats)) {
    if (result.stats.discovered !== discovered.size) {
      fail('V10', `stats.discovered must be ${discovered.size}`);
    }
    const visits = events.filter((e) => isPlainObject(e) && e.type === 'visit').length;
    if (result.stats.visited !== visits) {
      fail('V10', `stats.visited must be ${visits}`);
    }
    
    const expectedLength =
      Array.isArray(result.path) && result.path.length > 0
        ? result.path.length - 1
        : 0;

    if (result.stats.pathLength !== expectedLength) {
      fail('V10', `stats.pathLength must be ${expectedLength}`);
    }

  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePath(path, discovered, result, dict, fail) {
  if (path.length === 0) {
    fail('V8', 'path must not be empty');
    return;
  }
  if (path[0] !== result.start) fail('V8', 'path must start at start');
  if (path[path.length - 1] !== result.end) fail('V8', 'path must end at end');
  const seen = new Set();
  for (const word of path) {
    if (seen.has(word)) fail('V8', `path contains ${word} more than once`);
    seen.add(word);
  }
  for (let i = 0; i + 1 < path.length; i++) {
    if (dict.has(path[i]) && !dict.neighbors(path[i]).includes(path[i + 1])) {
      fail('V8', `${path[i]} and ${path[i + 1]} are not adjacent`);
    }
  }
  // Parent chain of end at the end of replay.
  const chain = [];
  let cursor = result.end;
  const guard = new Set();
  while (cursor !== undefined && cursor !== null) {
    if (guard.has(cursor)) break;
    guard.add(cursor);
    chain.push(cursor);
    const entry = discovered.get(cursor);
    if (!entry) break;
    cursor = entry.from;
  }
  chain.reverse();
  if (chain.length !== path.length || chain.some((word, i) => word !== path[i])) {
    fail('V8', 'path must equal the parent chain of end');
  }
}
