import { MAX_EVENTS_PER_TICK, MIN_SPEED, MAX_SPEED } from './config.js';

export const defaultScheduler = {
  request(callback) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return setTimeout(() => callback(Date.now()), 16);
  },
  cancel(id) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
  },
  now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  },
};

function clampSpeed(speed) {
  if (!Number.isFinite(speed)) return MIN_SPEED;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/**
 * Spec 06 - Replay engine. Turns a recorded Result into a controllable
 * timeline and keeps the derived state the UI and renderer need. Pure data:
 * no DOM, no Cytoscape.
 */
export function createReplay(
  result,
  { scheduler = defaultScheduler, maxEventsPerTick = MAX_EVENTS_PER_TICK, speed = 4 } = {},
) {
  const events = result.events;
  const total = events.length;
  const frontierMode = result.frontierMode;

  let index = 0;
  let playing = false;
  let currentSpeed = clampSpeed(speed);
  let destroyed = false;
  let pendingId = null;
  let lastTick = 0;

  const subscribers = new Set();

  const records = new Map();
  const discoveryOrder = [];
  const visitedOrder = [];
  let discSeq = 0;
  let pathWords = null;
  let failure = null;

  const state = {
    get current() {
      return visitedOrder.length > 0 ? visitedOrder[visitedOrder.length - 1] : null;
    },
    get discovered() {
      return records.size;
    },
    get visited() {
      return visitedOrder.length;
    },
    get frontierSize() {
      return records.size - visitedOrder.length;
    },
    statusOf(word) {
      return statusOfWord(word);
    },
    parentOf(word) {
      const record = records.get(word);
      return record ? record.parent : undefined;
    },
    depthOf(word) {
      const record = records.get(word);
      return record ? record.depth : undefined;
    },
    frontierPreview(k = 10) {
      return frontierPreview(k);
    },
    get pathWords() {
      return pathWords;
    },
    get failure() {
      return failure;
    },
    get atEnd() {
      return index === total;
    },
    forEachDiscovered(fn) {
      for (const word of discoveryOrder) {
        const record = records.get(word);
        if (!record) continue;
        fn(word, record.parent, record.depth, statusOfWord(word));
      }
    },
  };

  function indexCmp(a, b) {
    return a - b;
  }

  function frontierPreview(k) {
    const words = [];
    for (const [word, record] of records) {
      if (record.status === 'frontier') words.push(word);
    }
    const mode = result.frontierMode;
    words.sort((a, b) => {
      const ra = records.get(a);
      const rb = records.get(b);
      if (mode === 'priority-h' || mode === 'priority-f') {
        if (ra.score !== rb.score) return ra.score - rb.score;
      }
      if (mode === 'priority-f') {
        const ha = ra.score - ra.depth;
        const hb = rb.score - rb.depth;
        if (ha !== hb) return ha - hb;
        return indexCmp(ra.scoreSeq, rb.scoreSeq);
      }
      return indexCmp(ra.discSeq, rb.discSeq);
    });
    return words.slice(0, k);
  }

  function statusOfWord(word) {
    const record = records.get(word);
    if (!record) return 'unseen';
    return record.status;
  }

  function resetState() {
    records.clear();
    discoveryOrder.length = 0;
    visitedOrder.length = 0;
    index = 0;
    discSeq = 0;
    pathWords = null;
    failure = null;
  }

  function applyEvent(event, eventIndex) {
    if (event.type === 'discover') {
      const word = event.word;
      records.set(word, {
        parent: event.from,
        depth: event.depth,
        score: event.score,
        status: 'frontier',
        discSeq: discSeq++,
        scoreSeq: eventIndex,
        prevScoreSeq: eventIndex,
      });
      discoveryOrder.push(word);
    } else if (event.type === 'reparent') {
      const record = records.get(event.word);
      if (record) {
        record.prevScoreSeq = record.scoreSeq;
        record.parent = event.from;
        record.depth = event.depth;
        record.score = event.score;
        record.scoreSeq = eventIndex;
      }
    } else if (event.type === 'visit') {
      const record = records.get(event.word);
      if (record) record.status = 'visited';
      visitedOrder.push(event.word);
    } else if (event.type === 'path') {
      pathWords = event.words.slice();
    } else if (event.type === 'fail') {
      failure = { reason: event.reason };
    }
  }

  function undoEvent(event) {
    if (event.type === 'discover') {
      records.delete(event.word);
      if (discoveryOrder[discoveryOrder.length - 1] === event.word) discoveryOrder.pop();
      discSeq--;
    } else if (event.type === 'reparent') {
      const record = records.get(event.word);
      if (record) {
        record.parent = event.prevFrom;
        record.depth = event.prevDepth;
        record.score = event.prevScore;
        record.scoreSeq = record.prevScoreSeq;
      }
    } else if (event.type === 'visit') {
      const record = records.get(event.word);
      if (record) record.status = 'frontier';
      if (visitedOrder[visitedOrder.length - 1] === event.word) visitedOrder.pop();
    } else if (event.type === 'path') {
      pathWords = null;
    } else if (event.type === 'fail') {
      failure = null;
    }
  }

  function emit(change) {
    if (destroyed) return;
    const enriched = { ...change, index, playing };
    for (const subscriber of [...subscribers]) subscriber(enriched);
  }

  function step() {
    if (index >= total) return;
    const event = events[index];
    applyEvent(event, index);
    index++;
    emit({ kind: 'forward', events: [event] });
  }

  function back() {
    if (index <= 0) return;
    if (playing) pause();
    index--;
    const event = events[index];
    undoEvent(event);
    emit({ kind: 'backward', events: [event] });
  }

  function seek(target) {
    const clamped = Math.max(0, Math.min(total, Math.floor(target)));
    resetState();
    for (let i = 0; i < clamped; i++) applyEvent(events[i], i);
    index = clamped;
    emit({ kind: 'reset' });
  }

  function tick() {
    pendingId = null;
    if (destroyed || !playing) return;
    const now = scheduler.now();
    const elapsed = Math.max(0, now - lastTick);
    lastTick = now;
    const due = Math.floor((elapsed / 1000) * currentSpeed);
    const count = Math.min(due, maxEventsPerTick, total - index);
    if (count > 0) {
      const applied = [];
      for (let i = 0; i < count; i++) {
        applyEvent(events[index], index);
        applied.push(events[index]);
        index++;
      }
      if (index >= total) {
        playing = false;
        emit({ kind: 'forward', events: applied });
        emit({ kind: 'status' });
        return;
      }
      emit({ kind: 'forward', events: applied });
    }
    if (playing) pendingId = scheduler.request(tick);
  }

  function play() {
    if (playing || destroyed || index >= total) return;
    playing = true;
    lastTick = scheduler.now();
    emit({ kind: 'status' });
    pendingId = scheduler.request(tick);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    if (pendingId !== null) {
      scheduler.cancel(pendingId);
      pendingId = null;
    }
    emit({ kind: 'status' });
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function setSpeed(value) {
    const next = clampSpeed(value);
    if (next === currentSpeed) return;
    currentSpeed = next;
    emit({ kind: 'status' });
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function destroy() {
    destroyed = true;
    if (pendingId !== null) {
      scheduler.cancel(pendingId);
      pendingId = null;
    }
    subscribers.clear();
  }

  return {
    get index() {
      return index;
    },
    get total() {
      return total;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return currentSpeed;
    },
    state,
    step,
    back,
    seek,
    play,
    pause,
    toggle,
    setSpeed,
    subscribe,
    destroy,
  };
}
