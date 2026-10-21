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
  focusCurrent: el('focus-current'),
  autoFollow: el('auto-follow'),
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
  playIcon: el('play-icon'),
  playText: el('play-text'),
  step: el('step-button'),
  skip: el('skip-button'),
  turboBtn: el('turbo-btn'),
  scrub: el('scrub'),
  stepCounter: el('step-counter'),
  speed: el('speed'),
  speedLabel: el('speed-label'),
  overlay: el('status-overlay'),
  statusMessage: el('status-message'),
  retry: el('retry-button'),
  hudStatusText: el('hud-status-text'),
  hudPulse: el('hud-pulse'),
  hudTargetWord: el('hud-target-word'),
  hudFromWord: el('hud-from-word'),
  hudToWord: el('hud-to-word'),
  hudFromChip: el('hud-from-chip'),
  hudDiffDesc: el('hud-diff-desc'),
  hudDepthVal: el('hud-depth-val'),
  hudQueueVal: el('hud-queue-val'),
  hudVisitedVal: el('hud-visited-val'),
  tabFrontierCount: el('tab-frontier-count'),
  tabPathCount: el('tab-path-count'),
  solutionMatrix: el('solution-matrix'),
  pathStepsBadge: el('path-steps-badge'),
  btnViewMatrix: el('btn-view-matrix'),
  btnViewList: el('btn-view-list'),
  btnCopySolution: el('btn-copy-solution'),
  btnShareLink: el('btn-share-link'),
  lengthChips: el('length-chips'),
};

const PLAYBACK_SPEEDS = [...SPEED_STOPS, 120, 240];
let lastFollowTime = 0;

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

  if (dom.hudTargetWord) dom.hudTargetWord.textContent = end;
  if (dom.hudToWord) dom.hudToWord.textContent = start;
  if (dom.hudFromWord) dom.hudFromWord.textContent = '–';
  if (dom.hudFromChip) dom.hudFromChip.hidden = true;
  if (dom.hudDiffDesc) dom.hudDiffDesc.textContent = `Titik awal: "${start}"`;
  if (dom.hudStatusText) dom.hudStatusText.textContent = `Mengeksplorasi (${dom.algorithm.value.toUpperCase()})...`;

  app.replay = createReplay(result, {
    speed: PLAYBACK_SPEEDS[Number(dom.speed.value)] ?? DEFAULT_SPEED,
    maxEventsPerTick: 60,
  });
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

function getDiff(word1, word2) {
  if (!word1 || !word2 || word1.length !== word2.length) return null;
  for (let i = 0; i < word1.length; i++) {
    if (word1[i] !== word2[i]) {
      return { index: i, fromChar: word1[i], toChar: word2[i] };
    }
  }
  return null;
}

function renderWordTiles(word, highlightIndex = -1) {
  const container = document.createElement('span');
  container.className = 'word-tiles';
  for (let i = 0; i < word.length; i++) {
    const tile = document.createElement('span');
    tile.className = 'char-tile' + (i === highlightIndex ? ' diff' : '');
    tile.textContent = word[i].toUpperCase();
    container.appendChild(tile);
  }
  return container;
}

function renderSolutionMatrix(container, pathWords) {
  if (!container) return;
  container.replaceChildren();
  if (!pathWords || pathWords.length === 0) return;

  const targetWord = pathWords[pathWords.length - 1];
  const wordLen = targetWord.length;

  const matrix = document.createElement('div');
  matrix.className = 'wordle-matrix';

  for (let r = 0; r < pathWords.length; r++) {
    const word = pathWords[r];
    const prevWord = r > 0 ? pathWords[r - 1] : null;

    const rowEl = document.createElement('div');
    rowEl.className = 'matrix-row';

    const stepLabel = document.createElement('span');
    stepLabel.className = 'matrix-row-label';
    stepLabel.textContent = r === 0 ? 'START' : r === pathWords.length - 1 ? 'GOAL' : `#${r}`;

    const tilesWrapper = document.createElement('div');
    tilesWrapper.className = 'matrix-tiles';
    tilesWrapper.style.gridTemplateColumns = `repeat(${wordLen}, 1fr)`;

    for (let c = 0; c < wordLen; c++) {
      const char = word[c];
      const box = document.createElement('div');
      box.className = 'matrix-box';
      box.textContent = char.toUpperCase();

      if (char === targetWord[c]) {
        box.classList.add('correct');
      } else {
        box.classList.add('wrong');
      }

      if (prevWord && char !== prevWord[c]) {
        box.classList.add('changed-letter');
      }

      tilesWrapper.appendChild(box);
    }

    rowEl.appendChild(stepLabel);
    rowEl.appendChild(tilesWrapper);
    matrix.appendChild(rowEl);
  }

  container.appendChild(matrix);
}

function onReplayChange(change) {
  if (!app.replay || !app.renderer) return;
  app.renderer.apply(change, app.replay.state);
  updateTransport();

  if (dom.autoFollow?.checked && app.replay.state.current) {
    const now = performance.now();
    if (now - lastFollowTime >= 180) {
      app.renderer.centerOn(app.replay.state.current, false);
      lastFollowTime = now;
    }
  }

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

  const current = app.replay.state.current;
  const parent = current ? app.replay.state.parentOf(current) : null;
  const atEnd = app.replay.state.atEnd;

  // Live HUD updates
  if (dom.hudStatusText) {
    if (atEnd) {
      dom.hudStatusText.textContent = app.result?.found ? '🎉 Solusi Ditemukan!' : 'Pencarian Selesai';
      dom.hudPulse?.classList.toggle('success', !!app.result?.found);
      dom.hudPulse?.classList.remove('searching');
    } else if (app.replay.playing) {
      dom.hudStatusText.textContent = `Mengeksplorasi (${dom.algorithm.value.toUpperCase()})...`;
      dom.hudPulse?.classList.add('searching');
      dom.hudPulse?.classList.remove('success');
    } else {
      dom.hudStatusText.textContent = 'Pencarian Terjeda';
      dom.hudPulse?.classList.remove('searching');
    }
  }

  if (current) {
    if (dom.hudToWord) dom.hudToWord.textContent = current;
    if (parent) {
      if (dom.hudFromWord) dom.hudFromWord.textContent = parent;
      if (dom.hudFromChip) dom.hudFromChip.hidden = false;
      const diff = getDiff(parent, current);
      if (dom.hudDiffDesc) {
        if (diff) {
          dom.hudDiffDesc.innerHTML = `Ubah huruf ke-${diff.index + 1}: <span class="char-badge old">'${diff.fromChar}'</span> ➔ <span class="char-badge new">'${diff.toChar}'</span>`;
        } else {
          dom.hudDiffDesc.textContent = `Transformasi dari "${parent}"`;
        }
      }
    } else {
      if (dom.hudFromWord) dom.hudFromWord.textContent = '–';
      if (dom.hudFromChip) dom.hudFromChip.hidden = true;
      if (dom.hudDiffDesc) dom.hudDiffDesc.textContent = `Titik awal: "${current}"`;
    }
  }

  if (dom.hudDepthVal) dom.hudDepthVal.textContent = current ? String(app.replay.state.depthOf(current) ?? 0) : '0';
  if (dom.hudQueueVal) dom.hudQueueVal.textContent = String(replay.state.frontierSize);
  if (dom.hudVisitedVal) dom.hudVisitedVal.textContent = String(app.replay.state.visited);
  if (dom.tabFrontierCount) dom.tabFrontierCount.textContent = String(replay.state.frontierSize);

  dom.frontierLabel.textContent = frontierLabel(app.result.frontierMode);
  dom.frontierTotal.textContent = String(replay.state.frontierSize);
  dom.frontierList.replaceChildren(
    ...app.replay.state.frontierPreview(15).map((word) => {
      const item = document.createElement('li');
      item.className = 'frontier-item';
      const p = app.replay.state.parentOf(word);
      const diff = getDiff(p, word);

      const wordSpan = document.createElement('span');
      wordSpan.className = 'frontier-word font-mono';
      wordSpan.textContent = word;
      item.appendChild(wordSpan);

      if (p) {
        const fromSpan = document.createElement('span');
        fromSpan.className = 'frontier-parent';
        fromSpan.textContent = ` (dari ${p}${diff ? `, ubah '${diff.toChar}'` : ''})`;
        item.appendChild(fromSpan);
      }
      return item;
    }),
  );

  dom.statDiscovered.textContent = String(app.replay.state.discovered);
  dom.statVisited.textContent = String(app.replay.state.visited);

  dom.statDepth.textContent = current
    ? String(app.replay.state.depthOf(current) ?? '\u2013')
    : '\u2013';

  dom.statDrawn.textContent = String(
    app.renderer ? app.renderer.counts().rendered : 0,
  );
  dom.statHidden.textContent = String(
    app.renderer ? app.renderer.counts().hidden : 0,
  );

  const pathWords = app.replay.state.pathWords ?? [];

  dom.statPath.textContent = pathWords.length > 0
    ? String(pathWords.length - 1)
    : '\u2013';

  if (dom.tabPathCount) dom.tabPathCount.textContent = String(pathWords.length > 0 ? pathWords.length - 1 : 0);
  if (dom.pathStepsBadge) dom.pathStepsBadge.textContent = pathWords.length > 0 ? `${pathWords.length - 1} Langkah` : '0 Langkah';

  renderSolutionMatrix(dom.solutionMatrix, pathWords);

  dom.pathList.replaceChildren(
    ...pathWords.map((word, idx) => {
      const item = document.createElement('li');
      item.className = 'ladder-step' + (idx === 0 ? ' start' : idx === pathWords.length - 1 ? ' end' : '');
      const prevWord = idx > 0 ? pathWords[idx - 1] : null;
      const diff = getDiff(prevWord, word);

      const badge = document.createElement('span');
      badge.className = 'step-idx';
      badge.textContent = idx === 0 ? 'AWAL' : idx === pathWords.length - 1 ? 'TUJUAN' : `Langkah ${idx}`;

      const tiles = renderWordTiles(word, diff ? diff.index : -1);
      item.append(badge, tiles);

      if (diff) {
        const note = document.createElement('span');
        note.className = 'step-note';
        note.innerHTML = `<span class="letter-change">Huruf #${diff.index + 1}: <strong>'${diff.fromChar}'</strong> ➔ <strong>'${diff.toChar}'</strong></span>`;
        item.append(note);
      }
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
  if (dom.skip) dom.skip.disabled = index >= total;

  if (dom.playIcon && dom.playText) {
    dom.playIcon.textContent = playing ? '⏸' : '▶';
    dom.playText.textContent = playing ? 'Jeda' : 'Putar';
  } else {
    dom.play.textContent = playing ? 'Pause' : 'Play';
  }

  if (dom.stepCounter) {
    dom.stepCounter.textContent = `Langkah ${index} / ${total}`;
  }

  dom.scrub.max = String(total);
  dom.scrub.value = String(index);
  dom.scrub.disabled = total === 0;
}

/* ---------- transport controls ---------- */

dom.back.addEventListener('click', () => app.replay?.back());
dom.play.addEventListener('click', () => app.replay?.toggle());
dom.step.addEventListener('click', () => app.replay?.step());
dom.skip?.addEventListener('click', () => app.replay?.seek(app.replay.total));
dom.scrub.addEventListener('input', () => app.replay?.seek(Number(dom.scrub.value)));
dom.speed.addEventListener('input', () => {
  const stop = PLAYBACK_SPEEDS[Number(dom.speed.value)] ?? 64;
  dom.speedLabel.textContent = stop === 240 ? '240/s 🚀' : speedLabel(stop);
  app.replay?.setSpeed(stop);
});
dom.turboBtn?.addEventListener('click', () => {
  dom.speed.value = String(PLAYBACK_SPEEDS.length - 1);
  const stop = PLAYBACK_SPEEDS[PLAYBACK_SPEEDS.length - 1];
  dom.speedLabel.textContent = '240/s 🚀';
  app.replay?.setSpeed(stop);
});
dom.speed.value = String(PLAYBACK_SPEEDS.indexOf(DEFAULT_SPEED));
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
dom.focusCurrent?.addEventListener('click', () => {
  const current = app.replay?.state?.current;
  if (current && app.renderer) {
    app.renderer.centerOn(current);
  }
});

// View switch between Matrix and List
dom.btnViewMatrix?.addEventListener('click', () => {
  if (dom.solutionMatrix) dom.solutionMatrix.hidden = false;
  if (dom.pathList) dom.pathList.hidden = true;
  dom.btnViewMatrix?.classList.add('active');
  dom.btnViewList?.classList.remove('active');
});

dom.btnViewList?.addEventListener('click', () => {
  if (dom.solutionMatrix) dom.solutionMatrix.hidden = true;
  if (dom.pathList) dom.pathList.hidden = false;
  dom.btnViewList?.classList.add('active');
  dom.btnViewMatrix?.classList.remove('active');
});

// Copy Solution
dom.btnCopySolution?.addEventListener('click', () => {
  const pathWords = app.replay?.state?.pathWords ?? [];
  if (pathWords.length === 0) return;
  const text = `Word Ladder (${pathWords.length - 1} langkah):\n${pathWords.join(' ➔ ')}`;
  navigator.clipboard?.writeText(text).then(() => {
    const prev = dom.btnCopySolution.textContent;
    dom.btnCopySolution.textContent = '✅ Tersalin!';
    setTimeout(() => { if (dom.btnCopySolution) dom.btnCopySolution.textContent = prev; }, 1800);
  });
});

// Share Link
dom.btnShareLink?.addEventListener('click', () => {
  navigator.clipboard?.writeText(window.location.href).then(() => {
    const prev = dom.btnShareLink.textContent;
    dom.btnShareLink.textContent = '✅ Link Tersalin!';
    setTimeout(() => { if (dom.btnShareLink) dom.btnShareLink.textContent = prev; }, 1800);
  });
});

// Length selector chips
const LEN_EXAMPLES = {
  3: { start: 'cat', end: 'mau' },
  4: { start: 'kata', end: 'bola' },
  5: { start: 'makan', end: 'rumah' },
  6: { start: 'pulang', end: 'datang' },
};
if (dom.lengthChips) {
  for (const chip of dom.lengthChips.querySelectorAll('.len-chip')) {
    chip.addEventListener('click', () => {
      for (const c of dom.lengthChips.querySelectorAll('.len-chip')) c.classList.remove('active');
      chip.classList.add('active');
      const len = Number(chip.dataset.len);
      const sample = LEN_EXAMPLES[len];
      if (sample) {
        dom.startInput.value = sample.start;
        dom.endInput.value = sample.end;
        clearErrors();
        syncHash();
      }
    });
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) app.replay?.pause();
});

window.addEventListener('resize', () => app.renderer?.fit());

setPhase('idle');
