/**
 * Spec 08 - pure UI formatting helpers. No DOM, no state.
 */

const MESSAGES = {
  EMPTY: 'Enter both words.',
  INVALID_CHARS: 'Use letters a-z only.',
  LENGTH_MISMATCH: 'Both words must be the same length.',
  WRONG_DICTIONARY: 'Internal error: wrong dictionary loaded.',
};

/** UI-1: the exact validation messages from spec 01. */
export function formatValidationMessage(code, ctx = {}) {
  if (code === 'UNSUPPORTED_LENGTH') {
    return `Words of length ${ctx.length} aren't supported. Try 3 to 6 letters.`;
  }
  if (code === 'UNKNOWN_START' || code === 'UNKNOWN_END') {
    return `"${ctx.word}" isn't in the word list.`;
  }
  return MESSAGES[code] ?? '';
}

/** UI-3: the label under the speed slider. */
export function speedLabel(speed) {
  return `${speed}/s`;
}

/** UI-5: what the frontier panel calls the open list. */
export function frontierLabel(mode) {
  return mode === 'fifo' ? 'Queue' : 'Priority list';
}

function plural(count, noun) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** UI-4: one summary line for the end of a replay. */
export function summaryText(result) {
  const visited = result?.stats?.visited ?? 0;
  if (result?.found) {
    const words = result.path?.length ?? 0;
    return `Found a ladder of ${words} words after ${plural(visited, 'visit')}.`;
  }
  const last = result?.events?.[result.events.length - 1];
  const reason = last && last.type === 'fail' ? last.reason : 'unreachable';
  if (reason === 'limit') {
    return `Stopped after ${plural(visited, 'visit')} without finding a ladder.`;
  }
  return 'No ladder exists between these words.';
}
