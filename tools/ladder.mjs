#!/usr/bin/env node
/**
 * P1-6 - CLI smoke check on the real patterns/ data.
 *
 *   node tools/ladder.mjs kata bola bfs
 *   node tools/ladder.mjs --examples        # validates the UI example pairs (UI-6)
 *
 * Prints the path, stats, the validator result, and the search time (B2).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadBuckets, createDictionary, validateInput, normalizeWord } from '../src/data.js';
import { runSearch, algorithms, DEFAULT_ALGORITHM } from '../src/search/index.js';
import { validateEvents } from '../src/events.js';
import { SEARCH_MAX_VISITS, EXAMPLES } from '../src/config.js';

const patternsUrl = new URL('../dataset/patterns/', import.meta.url);

// Node's global fetch cannot read file:// URLs, so the CLI gets its own reader
// that speaks the same interface loadBuckets expects.
function localFetch(url) {
  try {
    const path = fileURLToPath(url);
    const text = readFileSync(path, 'utf8');
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(text) });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    return Promise.reject(error);
  }
}

async function dictionaryFor(length) {
  const buckets = await loadBuckets(length, { baseUrl: patternsUrl.href, fetch: localFetch });
  return createDictionary(buckets, length);
}

function formatMs(ms) {
  return `${ms.toFixed(1)} ms`;
}

async function checkExamples() {
  console.log('UI-6 example pairs against the real patterns/ data:\n');
  let failures = 0;
  for (const { start, end } of EXAMPLES) {
    const dict = await dictionaryFor(start.length);
    const result = validateInput(dict, start, end);
    if (result.ok) {
      console.log(`  ok    ${result.start} -> ${result.end}`);
    } else {
      failures++;
      console.log(`  FAIL  ${start} -> ${end}: ${result.code} - ${result.message}`);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} example pair(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll example pairs are valid.');
  }
}

async function runLadder(startInput, endInput, algorithmId) {
  const algorithm = algorithms[algorithmId];
  if (!algorithm) {
    console.error(`Unknown algorithm "${algorithmId}". Try one of: ${Object.keys(algorithms).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  const length = normalizeWord(startInput).length;
  let dict;
  try {
    dict = await dictionaryFor(length);
  } catch (error) {
    console.error(`Could not load the ${length}-letter dictionary: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const validation = validateInput(dict, startInput, endInput);
  if (!validation.ok) {
    console.error(`Invalid input: ${validation.message}`);
    process.exitCode = 1;
    return;
  }

  const began = performance.now();
  const result = runSearch(algorithmId, dict, validation.start, validation.end, {
    maxVisits: SEARCH_MAX_VISITS,
  });
  const elapsed = performance.now() - began;

  const check = validateEvents(result, dict);
  console.log(`${algorithm.label} (${algorithmId}): ${validation.start} -> ${validation.end}`);
  console.log(`  found:      ${result.found}`);
  console.log(`  path:       ${result.found ? result.path.join(' -> ') : '(none)'}`);
  console.log(`  pathLength: ${result.stats.pathLength}`);
  console.log(`  discovered: ${result.stats.discovered}`);
  console.log(`  visited:    ${result.stats.visited}`);
  console.log(`  events:     ${result.events.length}`);
  console.log(`  validator:  ${check.ok ? 'ok' : `FAILED: ${check.errors.join('; ')}`}`);
  console.log(`  search:     ${formatMs(elapsed)} (B2 budget: under 150 ms on the throttled profile)`);
  if (!check.ok) process.exitCode = 1;
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--examples') {
  await checkExamples();
} else {
  const [start, end, algorithm = DEFAULT_ALGORITHM] = args;
  if (!end) {
    console.error('Usage: node tools/ladder.mjs <start> <end> [algorithm]');
    console.error('       node tools/ladder.mjs --examples');
    process.exitCode = 1;
  } else {
    await runLadder(start, end, algorithm);
  }
}
