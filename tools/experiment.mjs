#!/usr/bin/env node
// Eksperimen Bab III: membangkitkan pasangan kata uji (Skenario 1-3) dan
// mengukur BFS, GBFS, dan A* pada pasangan yang sama.
//
// Jalankan dari root repo:   node tools/experiment.mjs
// Opsi lingkungan:           SEED=20260 REPS=10 node tools/experiment.mjs
// Keluaran:                  results/experiment.csv, results/meta.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { loadBuckets, createDictionary } from '../src/data.js';
import { runBfs } from '../src/search/bfs.js';
import { runGreedy } from '../src/search/greedy.js';
import { runAstar } from '../src/search/astar.js';

const SEED = Number(process.env.SEED ?? 20260);
const REPS = Number(process.env.REPS ?? 10);
const LENGTHS = [4, 5, 6];
const ALGOS = [
  ['bfs', runBfs],
  ['gbfs', runGreedy],
  ['astar', runAstar],
];
const NORMAL_PER_DISTANCE = 5; // jarak 1..6 -> 30 pasangan per panjang kata
const LONG_MIN_DISTANCE = 10;
const LONG_COUNT = 10;
const IMPOSSIBLE_BIG = 5;
const IMPOSSIBLE_SMALL = 5;

// PRNG ber-seed (mulberry32): Math.random() di JavaScript tidak bisa di-seed.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const patternsUrl = new URL('../dataset/patterns/', import.meta.url);
const fileFetch = (url) => {
  const text = readFileSync(fileURLToPath(url), 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(text) });
};

async function buildGraph(length) {
  const buckets = await loadBuckets(length, { baseUrl: patternsUrl.href, fetch: fileFetch });
  const dict = createDictionary(buckets, length);
  const wordSet = new Set();
  for (const list of Object.values(buckets)) for (const w of list) wordSet.add(w);
  const words = [...wordSet].sort();
  const nb = new Map(words.map((w) => [w, [...dict.neighbors(w)]]));

  // komponen terhubung
  const comp = new Map();
  const comps = [];
  for (const w of words) {
    if (comp.has(w)) continue;
    const id = comps.length;
    const q = [w];
    comp.set(w, id);
    for (let i = 0; i < q.length; i++) {
      for (const n of nb.get(q[i])) {
        if (!comp.has(n)) {
          comp.set(n, id);
          q.push(n);
        }
      }
    }
    comps.push(q);
  }
  let bigId = 0;
  comps.forEach((c, i) => {
    if (c.length > comps[bigId].length) bigId = i;
  });
  return { dict, words, nb, comp, comps, bigId };
}

function distancesFrom(graph, start) {
  const dist = new Map([[start, 0]]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    for (const n of graph.nb.get(q[i])) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(q[i]) + 1);
        q.push(n);
      }
    }
  }
  return dist;
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

function generatePairs(graph, length) {
  const rnd = mulberry32(SEED + length);
  const big = graph.comps[graph.bigId];
  const small = graph.words.filter((w) => graph.comp.get(w) !== graph.bigId);
  const used = new Set();
  const pairs = [];
  const add = (scenario, group, s, e, dist) => {
    const key = `${s}|${e}`;
    if (used.has(key)) return false;
    used.add(key);
    pairs.push({ scenario, group, length, start: s, end: e, dist });
    return true;
  };

  // Skenario 1: 5 pasangan untuk setiap jarak 1..6 (dari komponen terbesar)
  for (let d = 1; d <= 6; d++) {
    let got = 0;
    for (let tries = 0; got < NORMAL_PER_DISTANCE && tries < 100000; tries++) {
      const s = pick(rnd, big);
      const dist = distancesFrom(graph, s);
      const cand = [...dist].filter(([, x]) => x === d).map(([w]) => w);
      if (cand.length && add('normal', `d=${d}`, s, pick(rnd, cand), d)) got++;
    }
    if (got < NORMAL_PER_DISTANCE) throw new Error(`Normal d=${d} L=${length}: hanya ${got} pasangan`);
  }

  // Skenario 2: jarak >= 10 (dari komponen terbesar)
  {
    let got = 0;
    for (let tries = 0; got < LONG_COUNT && tries < 200000; tries++) {
      const s = pick(rnd, big);
      const dist = distancesFrom(graph, s);
      const cand = [...dist].filter(([, x]) => x >= LONG_MIN_DISTANCE);
      if (!cand.length) continue;
      const [e, d] = pick(rnd, cand);
      if (add('long', `d>=${LONG_MIN_DISTANCE}`, s, e, d)) got++;
    }
    if (got < LONG_COUNT) throw new Error(`Long path L=${length}: hanya ${got} pasangan`);
  }

  // Skenario 3: kata awal dan tujuan pada komponen berbeda
  const otherThan = (compId) => graph.words.filter((w) => graph.comp.get(w) !== compId);
  for (let i = 0; i < IMPOSSIBLE_BIG; ) {
    const s = pick(rnd, big);
    const e = pick(rnd, otherThan(graph.bigId));
    if (add('impossible', 'start-largest', s, e, null)) i++;
  }
  for (let i = 0; i < IMPOSSIBLE_SMALL; ) {
    const s = pick(rnd, small);
    const sComp = graph.comp.get(s);
    let e;
    do {
      e = pick(rnd, graph.words);
    } while (graph.comp.get(e) === sComp);
    if (add('impossible', 'start-small', s, e, null)) i++;
  }
  return pairs;
}

function measure(fn, dict, start, end) {
  fn(dict, start, end, { maxVisits: Infinity }); // pemanasan (warm-up), dibuang
  const times = [];
  let last;
  for (let r = 0; r < REPS; r++) {
    const t0 = performance.now();
    last = fn(dict, start, end, { maxVisits: Infinity });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const median = times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2;
  return { result: last, mean, median };
}

const problems = [];
const rows = [];
const header = [
  'scenario', 'length', 'group', 'pair', 'start', 'end', 'bfs_distance', 'start_component_size',
  'algo', 'found', 'path_transitions', 'nodes_explored', 'nodes_discovered', 'time_mean_ms', 'time_median_ms',
];

for (const length of LENGTHS) {
  const graph = await buildGraph(length);
  const pairs = generatePairs(graph, length);
  console.error(`L=${length}: ${pairs.length} pasangan`);
  pairs.forEach((p, idx) => {
    const compSize = graph.comps[graph.comp.get(p.start)].length;
    const byAlgo = {};
    for (const [name, fn] of ALGOS) {
      const { result, mean, median } = measure(fn, graph.dict, p.start, p.end);
      const transitions = result.found ? result.path.length - 1 : '';
      byAlgo[name] = { result, transitions };
      rows.push([
        p.scenario, length, p.group, `${length}-${p.scenario}-${idx + 1}`, p.start, p.end, p.dist ?? '', compSize,
        name, result.found, transitions, result.stats.visited, result.stats.discovered,
        mean.toFixed(4), median.toFixed(4),
      ]);
    }
    // pemeriksaan konsistensi
    const tag = `${length}/${p.scenario}/${p.start}->${p.end}`;
    if (p.scenario === 'impossible') {
      for (const [name, v] of Object.entries(byAlgo)) {
        if (v.result.found) problems.push(`${tag} ${name}: seharusnya tidak ada jalur`);
        if (v.result.stats.visited !== compSize) problems.push(`${tag} ${name}: visited=${v.result.stats.visited} != ukuran komponen ${compSize}`);
      }
    } else {
      const b = byAlgo.bfs.transitions;
      if (b !== p.dist) problems.push(`${tag}: BFS=${b}, jarak target=${p.dist}`);
      if (byAlgo.astar.transitions !== b) problems.push(`${tag}: A*=${byAlgo.astar.transitions} != BFS=${b}`);
      if (byAlgo.gbfs.transitions < b) problems.push(`${tag}: GBFS lebih pendek dari BFS`);
    }
  });
}

const outDir = new URL('../results/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('experiment.csv', outDir), [header, ...rows].map((r) => r.join(',')).join('\n') + '\n');
const cpus = os.cpus();
writeFileSync(
  new URL('meta.json', outDir),
  JSON.stringify(
    {
      seed: SEED,
      reps: REPS,
      node: process.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      cpu: cpus.length ? `${cpus[0].model} x${cpus.length}` : 'unknown',
      ramGB: Math.round(os.totalmem() / 2 ** 30),
    },
    null,
    2,
  ),
);

console.error(`Selesai: ${rows.length} baris -> results/experiment.csv`);
if (problems.length) {
  console.error(`PERINGATAN: ${problems.length} masalah konsistensi`);
  for (const p of problems.slice(0, 20)) console.error('  - ' + p);
  process.exitCode = 1;
} else {
  console.error('Semua pemeriksaan konsistensi lolos.');
}
