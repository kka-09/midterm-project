/** Serializable snapshot of a replay's derived state, for deep equality tests. */
export function snapshot(state) {
  const words = [];
  state.forEachDiscovered((word, parent, depth, status) => {
    words.push({ word, parent, depth, status });
  });
  return {
    current: state.current,
    discovered: state.discovered,
    visited: state.visited,
    frontierSize: state.frontierSize,
    pathWords: state.pathWords,
    failure: state.failure,
    words,
  };
}

/** A controllable scheduler for playback tests. */
export function createFakeScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  const scheduler = {
    request(callback) {
      const id = nextId++;
      tasks.set(id, callback);
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    now() {
      return now;
    },
  };
  return {
    scheduler,
    setNow(value) {
      now = value;
    },
    advance(ms) {
      now += ms;
      const due = [...tasks.entries()];
      tasks.clear();
      for (const [, callback] of due) callback(now);
    },
    pending() {
      return tasks.size;
    },
  };
}
