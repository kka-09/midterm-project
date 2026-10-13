import { SUPPORTED_LENGTHS } from './config.js';

/**
 * Spec 01 - Data layer.
 *
 * The dataset lives at dataset/patterns/N.json (referred to as patterns/N.json
 * in the specs). Each file maps a pattern (a word with exactly one letter
 * replaced by '*') to the sorted array of words matching it.
 */

export class DataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

const DEFAULT_BASE_URL = 'dataset/patterns/';

const bucketCache = new Map();

function patternFor(word, position) {
  return word.slice(0, position) + '*' + word.slice(position + 1);
}

export function loadBuckets(length, { baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  const url = `${baseUrl}${length}.json`;
  const cached = bucketCache.get(url);
  if (cached) return cached;
  const promise = fetchBuckets(url, length, fetchImpl);
  bucketCache.set(url, promise);
  promise.catch(() => bucketCache.delete(url));
  return promise;
}

async function fetchBuckets(url, length, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DataError('LOAD_FAILED', `Failed to load word list for length ${length}.`);
  }
  if (response.status === 404) {
    throw new DataError('NOT_FOUND', `No word list for length ${length}.`);
  }
  if (!response.ok) {
    throw new DataError('LOAD_FAILED', `Failed to load word list for length ${length}.`);
  }
  let buckets;
  try {
    buckets = await response.json();
  } catch (cause) {
    throw new DataError('BAD_FORMAT', `Word list for length ${length} is not valid JSON.`);
  }
  if (buckets === null || typeof buckets !== 'object' || Array.isArray(buckets)) {
    throw new DataError('BAD_FORMAT', `Word list for length ${length} has an unexpected shape.`);
  }
  return buckets;
}

export function createDictionary(buckets, length) {
  if (buckets === null || typeof buckets !== 'object' || Array.isArray(buckets)) {
    throw new DataError('BAD_FORMAT', 'Word list must be an object.');
  }
  const keys = Object.keys(buckets);
  if (keys.length === 0) {
    throw new DataError('BAD_FORMAT', 'Word list must not be empty.');
  }
  const wordLength = length ?? keys[0].length;
  if (!Number.isInteger(wordLength) || wordLength < 1) {
    throw new DataError('BAD_FORMAT', 'Word length must be a positive integer.');
  }
  for (const key of keys) {
    if (key.length !== wordLength || !key.includes('*')) {
      throw new DataError('BAD_FORMAT', `Invalid pattern key: ${key}`);
    }
    if (key.indexOf('*') !== key.lastIndexOf('*')) {
      throw new DataError('BAD_FORMAT', `Invalid pattern key: ${key}`);
    }
  }

  for (const key of keys) {
    if (!Array.isArray(buckets[key])) {
      throw new DataError('BAD_FORMAT', `Bucket ${key} must be an array.`);
    }
  }

  const cache = new Map();

  function neighbors(word) {
    if (!has(word)) {
      throw new DataError('UNKNOWN_WORD', `Unknown word: ${word}`);
    }
    const cached = cache.get(word);
    if (cached) return cached.slice();
    const found = new Set();
    for (let i = 0; i < wordLength; i++) {
      const bucket = buckets[patternFor(word, i)];
      if (!bucket) continue;
      for (const candidate of bucket) {
        if (candidate !== word) found.add(candidate);
      }
    }
    const sorted = [...found].sort(compareWords);
    cache.set(word, sorted);
    return sorted.slice();
  }

  function has(word) {
    if (typeof word !== 'string' || word.length !== wordLength) return false;
    const bucket = buckets[patternFor(word, 0)];
    if (!bucket) return false;
    for (const candidate of bucket) {
      if (candidate === word) return true;
    }
    return false;
  }

  return { wordLength, has, neighbors };
}

function compareWords(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function normalizeWord(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

export function validateInput(dict, start, end) {
  const s = normalizeWord(start);
  const e = normalizeWord(end);

  if (s.length === 0 || e.length === 0) {
    return { ok: false, code: 'EMPTY', message: 'Enter both words.' };
  }
  if (!/^[a-z]+$/.test(s) || !/^[a-z]+$/.test(e)) {
    return { ok: false, code: 'INVALID_CHARS', message: 'Use letters a-z only.' };
  }
  if (s.length !== e.length) {
    return { ok: false, code: 'LENGTH_MISMATCH', message: 'Both words must be the same length.' };
  }
  if (!SUPPORTED_LENGTHS.includes(s.length)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_LENGTH',
      message: `Words of length ${s.length} aren't supported. Try 3 to 6 letters.`
    };
  }
  // Codes 1-4 need no dictionary; a null dict is the pre-check form used by
  // the UI before the word list for this length has been loaded (spec 08).
  if (dict === null || dict === undefined) {
    return { ok: true, start: s, end: e };
  }
  if (dict.wordLength !== s.length) {
    return { ok: false, code: 'WRONG_DICTIONARY', message: 'Internal error: wrong dictionary loaded.' };
  }
  if (!dict.has(s)) {
    return { ok: false, code: 'UNKNOWN_START', message: `"${s}" isn't in the word list.` };
  }
  if (!dict.has(e)) {
    return { ok: false, code: 'UNKNOWN_END', message: `"${e}" isn't in the word list.` };
  }
  return { ok: true, start: s, end: e };
}

