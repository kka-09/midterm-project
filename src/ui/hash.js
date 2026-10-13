import { algorithms, DEFAULT_ALGORITHM } from '../search/index.js';

/**
 * Spec 08 - URL hash helpers. Inputs are reflected as
 * #start=cold&end=warm&algo=bfs. Loading never auto-runs.
 */

/** UI-2: serializes the inputs; empty fields are omitted. */
export function encodeHash({ start = '', end = '', algo = '' } = {}) {
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  if (algo) params.set('algo', algo);
  return params.toString();
}

/** UI-2: tolerant decoder. Unknown or malformed hashes yield empty values. */
export function decodeHash(hash) {
  const result = { start: '', end: '', algo: DEFAULT_ALGORITHM };
  if (typeof hash !== 'string' || hash.length === 0) return result;
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return result;

  let params;
  try {
    params = new URLSearchParams(text);
  } catch {
    return result;
  }

  const start = params.get('start');
  const end = params.get('end');
  const algo = params.get('algo');
  if (start) result.start = start;
  if (end) result.end = end;
  if (algo) result.algo = algorithms[algo] ? algo : DEFAULT_ALGORITHM;
  return result;
}
