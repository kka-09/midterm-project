import { loadBuckets, createDictionary, validateInput, normalizeWord } from './data.js';
import { algorithms, DEFAULT_ALGORITHM } from './search/index.js';
import { createReplay } from './replay.js';
import { createRenderer } from './renderer.js';
import { SEARCH_MAX_VISITS, DEFAULT_SPEED, SPEED_STOPS, EXAMPLES } from './config.js';
import { formatValidationMessage, summaryText, frontierLabel, speedLabel } from './ui/format.js';
import { encodeHash, decodeHash } from './ui/hash.js';

/**
 * Spec 08 - UI shell. Wires the data layer, search, replay, and renderer
 * together. Contains no algorithm logic.
 */

const ALGORITHM_NOTES = {
  bfs: 'always finds the shortest ladder',
  greedy: 'heads straight for the target; finds a ladder, not always the shortest',
  astar: 'shortest ladder, guided toward the target',
};

const el = (id) => document.getElementById(id);

const dom = {
  app: document.querySelector('.app'),
  graph: el('graph'),
  recenter: el('recenter'),
  hiddenCount: el('hidden-count'),
  live: el('live'),
  themeToggle: el('theme-toggle'),
  tabs: [...document.querySelectorAll('[role="tab"]')],
  panels: [...document.querySelectorAll('.panel')],
  startInput: el('start-input'),
  endInput: el('end-input'),
  startError: el('start-error'),
  endError: el('end-error'),
  swap: el('swap-button'),
  algorithm: el('algorithm'),
  algorithmNote: el('algorithm-note'),
  startButton: el('start-button'),
  examples: el('examples'),
  frontierLabel: el('frontier-label'),
  frontierTotal: el('frontier-total'),
  frontierList: el('frontier-list'),
  statDiscovered: el('stat-discovered'),
  statVisited: el('stat-visited'),
  statDepth: el('stat-depth'),
  statDrawn: el('stat-drawn'),
  statHidden: el('stat-hidden'),
  statPath: el('stat-path'),
  pathList: el('path-list'),
  back: el('back-button'),
  play: el('play-button'),
  step: el('step-button'),
  scrub: el('scrub'),
  speed: el('speed'),
  speedLabel: el('speed-label'),
  overlay: el('status-overlay'),
  statusMessage: el('status-message'),
  retry: el('retry-button'),
};

const app = {
  phase: 'booting',
  renderer: null,
  replay: null,
  result: null,
  dictionary: null,
  theme: 'light',
  themeOverride: null,
  lastPaint: 0,
  lastStart: { start: '', end: '' },
};

function setPhase(phase) {
  app.phase = phase;
  dom.app.dataset.phase = phase;
}

/* ---------- theme ---------- */

function applyTheme(name) {
  app.theme = name;
  document.documentElement.dataset.theme = name;
  if (app.renderer) app.renderer.setTheme(name);
}

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
applyTheme(prefersDark.matches ? 'dark' : 'light');
prefersDark.addEventListener('change', (event) => {
  if (!app.themeOverride) applyTheme(event.matches ? 'dark' : 'light');
});
dom.themeToggle.addEventListener('click', () => {
  app.themeOverride = app.theme === 'dark' ? 'light' : 'dark';
  applyTheme(app.themeOverride);
});

/* ---------- algorithm selector and examples ---------- */

for (const algorithm of Object.values(algorithms)) {
  const option = document.createElement('option');
  option.value = algorithm.id;
  option.textContent = algorithm.label;
  dom.algorithm.append(option);
}
dom.algorithm.value = DEFAULT_ALGORITHM;
dom.algorithmNote.textContent = ALGORITHM_NOTES[DEFAULT_ALGORITHM];
dom.algorithm.addEventListener('change', () => {
  dom.algorithmNote.textContent = ALGORITHM_NOTES[dom.algorithm.value] ?? '';
  syncHash();
});

for (const example of EXAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = `${example.start} \u2192 ${example.end}`;
  chip.addEventListener('click', () => {
    dom.startInput.value = example.start;
    dom.endInput.value = example.end;
    clearErrors();
  });
  dom.examples.append(chip);
}

/* ---------- tabs ---------- */

function selectTab(name) {
  for (const tab of dom.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.panel === name));
  }
  for (const panel of dom.panels) {
    panel.hidden = panel.dataset.panel !== name;
  }
}
for (const tab of dom.tabs) {
  tab.addEventListener('click', () => selectTab(tab.dataset.panel));
}
selectTab('setup');

/* ---------- errors and status ---------- */

function clearErrors() {
  dom.startError.textContent = '';
  dom.endError.textContent = '';
}

function showError(result) {
  clearErrors();
  const word = normalizeWord(result.code === 'UNKNOWN_END' ? dom.endInput.value : dom.startInput.value);
  const message = formatValidationMessage(result.code, { length: word.length, word });
  const target = result.code === 'UNKNOWN_END' ? dom.endError : dom.startError;
  target.textContent = message;
  if (result.code === 'UNKNOWN_END') dom.startError.textContent = '';
  dom.live.textContent = message;
}

function showOverlay(message) {
  dom.statusMessage.textContent = message;
  dom.overlay.hidden = false;
}

function hideOverlay() {
  dom.overlay.hidden = true;
}

/* ---------- hash ---------- */

function syncHash() {
  const start = normalizeWord(dom.startInput.value);
  const end = normalizeWord(dom.endInput.value);
  const hash = encodeHash({ start, end, algo: dom.algorithm.value });
  const url = hash ? `#${hash}` : '#';
  history.replaceState(null, '', url);
}

function loadFromHash() {
  const decoded = decodeHash(window.location.hash);
  if (decoded.start) dom.startInput.value = decoded.start;
  if (decoded.end) dom.endInput.value = decoded.end;
  dom.algorithm.value = decoded.algo;
  dom.algorithmNote.textContent = ALGORITHM_NOTES[decoded.algo] ?? '';
}
loadFromHash();

/* ---------- start flow ---------- */

async function startSearch() {
  clearErrors();
  hideOverlay();

  const pre = validateInput(null, dom.startInput.value, dom.endInput.value);
  if (!pre.ok) {
    showError(pre);
    setPhase('idle');
    return;
  }

  const length = normalizeWord(dom.startInput.value).length;
  setPhase('loading-dictionary');
  dom.startButton.disabled = true;
  dom.startButton.textContent = 'Loading\u2026';

  let buckets;
  try {
    buckets = await loadBuckets(length);
  } catch (error) {
    dom.startButton.disabled = false;
    dom.startButton.textContent = 'Start';
    setPhase('error');
    showOverlay(
      error && error.code === 'NOT_FOUND'
        ? `No word list for ${length}-letter words.`
        : 'The word list could not be loaded. Check your connection and retry.',
    );
    return;
  }

  const dictionary = createDictionary(buckets, length);
  const validated = validateInput(dictionary, dom.startInput.value, dom.endInput.value);
  if (!validated.ok) {
    dom.startButton.disabled = false;
    dom.startButton.textContent = 'Start';
    setPhase('idle');
    showError(validated);
    return;
  }

  app.dictionary = dictionary;
  dom.startButton.disabled = false;
  dom.startButton.textContent = 'Start';
  runSearch(validated.start, validated.end);
}

function runSearch(start, end) {
  const algorithmId = dom.algorithm.value;
  const algorithm = algorithms[algorithmId];
  setPhase('searching');
  app.lastStart = { start, end };

  if (app.renderer) {
    app.renderer.destroy();
    app.renderer = null;
  }
  if (app.replay) {
    app.replay.destroy();
    app.replay = null;
  }

  const result = algorithm.run(app.dictionary, start, end, { maxVisits: SEARCH_MAX_VISITS });
  app.result = result;

  if (typeof window.cytoscape !== 'function') {
    setPhase('error');
    showOverlay('The graph library failed to load.');
    return;
  }

  app.renderer = createRenderer(dom.graph, {
    cytoscape: window.cytoscape,
    start,
    end,
    theme: app.theme,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  app.renderer.fit();

  app.replay = createReplay(result, { speed: SPEED_STOPS[Number(dom.speed.value)] });
  app.replay.subscribe(onReplayChange);
  syncHash();
  setPhase('replay');

  paintPanels(true);
  updateTransport();
  dom.live.textContent = '';
  app.replay.play();
  setPhase('replay');
}

/* ---------- replay wiring ---------- */

function onReplayChange(change) {
  if (!app.replay || !app.renderer) return;
  app.renderer.apply(change, app.replay.state);
  updateTransport();

  const playing = app.replay.playing;
  const now = performance.now();
  if (!change.playbackOnly && !(change.kind === 'forward' && app.replay.playing)) {
    paintPanels();
    app.lastPaint = performance.now();
  } else if (now - app.lastPaint >= 100) {
    paintPanels();
    app.lastPaint = now;
  }

  if (app.replay.state.atEnd && !change.wasEnded) {
    onEnded();
  }
}

function onEnded() {
  const summary = summaryText(app.result);
  dom.live.textContent = summary;
  paintPanels(true);
  updateTransport();
}

/* ---------- panels ---------- */

function listWords(container, words) {
  dom[container].replaceChildren(
    ...words.map((word) => {
      const item = document.createElement('li');
      item.textContent = word;
      return item;
    }),
  );
}

function paintPanels() {
  const replay = app.replay;
  if (!replay) return;
  const view = app.replay.state;
  const counts = app.renderer ? app.renderer.counts() : { rendered: 0, hidden: 0, pathDrawn: null };

  dom.frontierLabel.textContent = frontierLabel(app.result.frontierMode);
  dom.frontierTotal.textContent = String(replay.state.frontierSize);
  dom.frontierList.replaceChildren(
    ...app.replay.state.frontierPreview(10).map((word) => {
      const item = document.createElement('li');
      item.textContent = word;
      return item;
    }),
  );

  dom.statDiscovered.textContent = String(app.replay.state.discovered);
  dom.statVisited.textContent = String(app.replay.state.visited);
  const current = app.replay.state.current;
  dom.statDepth.textContent = current ? String(app.replay.state.depthOf(current) ?? '\u2013') : '\u2013';
  dom.statDrawn.textContent = String(app.renderer ? app.renderer.counts().rendered : 0);
  dom.statHidden.textContent = String(app.renderer ? app.renderer.counts().hidden : 0);
  dom.statPath.textContent = app.replay.state.pathWords ? String(app.replay.state.pathWords.length) : '\u2013';

  const pathWords = app.replay.state.pathWords ?? [];
  dom.pathList.replaceChildren(
    ...pathWords.map((word) => {
      const item = document.createElement('li');
      item.textContent = word;
      return item;
    }),
  );

  updateHiddenCount();
}

function updateHiddenCount() {
  if (!app.renderer) {
    dom.hiddenCount.hidden = true;
    return;
  }
  const { hidden } = app.renderer.counts();
  dom.hiddenCount.hidden = hidden === 0;
  dom.hiddenCount.textContent = `${hidden} more ${hidden === 1 ? 'word' : 'words'} not drawn`;
}

function updateTransport() {
  if (!app.replay) return;
  const { index, total, playing } = app.replay;
  dom.back.disabled = index === 0;
  dom.step.disabled = index >= total;
  dom.play.textContent = playing ? 'Pause' : 'Play';
  dom.scrub.max = String(total);
  dom.scrub.value = String(index);
  dom.scrub.disabled = total === 0;
}

/* ---------- transport controls ---------- */

dom.back.addEventListener('click', () => app.replay?.back());
dom.play.addEventListener('click', () => app.replay?.toggle());
dom.step.addEventListener('click', () => app.replay?.step());
dom.scrub.addEventListener('input', () => app.replay?.seek(Number(dom.scrub.value)));
dom.speed.addEventListener('input', () => {
  const stop = SPEED_STOPS[Number(dom.speed.value)];
  dom.speedLabel.textContent = speedLabel(stop);
  app.replay?.setSpeed(stop);
});
dom.speed.value = String(SPEED_STOPS.indexOf(DEFAULT_SPEED));
dom.speedLabel.textContent = speedLabel(DEFAULT_SPEED);

/* ---------- misc wiring ---------- */

dom.startButton.addEventListener('click', startSearch);
dom.retry.addEventListener('click', startSearch);
dom.swap.addEventListener('click', () => {
  const start = dom.startInput.value;
  dom.startInput.value = dom.endInput.value;
  dom.endInput.value = start;
  clearErrors();
  syncHash();
});

for (const input of [dom.startInput, dom.endInput]) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      startSearch();
    }
  });
  input.addEventListener('change', syncHash);
}

dom.recenter.addEventListener('click', () => app.renderer?.fit());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) app.replay?.pause();
});

window.addEventListener('resize', () => app.renderer?.fit());

setPhase('idle');
