import { NODE_CAP, HARD_CAP } from './config.js';
import { createRadialLayout } from './layout.js';

/**
 * Spec 07 - Graph renderer. Applies replay changes to a Cytoscape instance.
 * It contains no algorithm logic; all state comes from the replay engine.
 */

const TRANSITION_MS = 150;

const PALETTE = {
  light: {
    background: '#f7f8fa',
    node: '#ffffff',
    nodeBorder: '#8a93a6',
    text: '#1f2430',
    visited: '#d7e3ff',
    visitedBorder: '#3b6fd4',
    current: '#ffd9a0',
    currentBorder: '#d97706',
    startBorder: '#15803d',
    endBorder: '#b91c1c',
    pathBorder: '#7c3aed',
    pathText: '#3b1d7a',
    edge: '#aab2c4',
    pathEdge: '#7c3aed',
  },
  dark: {
    background: '#12151c',
    node: '#1c212c',
    nodeBorder: '#5b647a',
    text: '#e8ecf4',
    visited: '#243a63',
    visitedBorder: '#6f9bf0',
    current: '#4a3a16',
    currentBorder: '#e0a83c',
    startBorder: '#4ade80',
    endBorder: '#f87171',
    pathBorder: '#a78bfa',
    pathText: '#e9ddff',
    edge: '#4a5265',
    pathEdge: '#a78bfa',
  },
};

function stylesFor(theme) {
  const c = PALETTE[theme] ?? PALETTE.light;
  const nodeShape = 'ellipse';
  return [
    {
      selector: 'node',
      style: {
        shape: nodeShape,
        label: 'data(label)',
        'background-color': c.node,
        'border-color': c.nodeBorder,
        'border-width': 2,
        color: c.text,
        'font-size': 11,
        'text-valign': 'center',
        'text-halign': 'center',
        width: 18,
        height: 18,
        'min-zoomed-font-size': 8,
        'transition-property': 'background-color, border-color, border-width, opacity, width, height',
        'transition-duration': `${TRANSITION_MS}ms`,
      },
    },
    { selector: 'node.start', style: { shape: 'round-rectangle', 'border-color': c.startBorder, 'border-width': 3 } },
    { selector: 'node.end', style: { shape: 'diamond', 'border-color': c.endBorder, 'border-width': 3 } },
    { selector: 'node.frontier', style: { 'background-color': 'transparent', 'border-color': c.nodeBorder, 'border-style': 'dashed' } },
    { selector: 'node.visited', style: { 'background-color': c.visited, 'border-color': c.visitedBorder } },
    { selector: 'node.current', style: { 'background-color': c.current, 'border-color': c.currentBorder, 'border-width': 4, width: 26, height: 26 } },
    { selector: 'node.path', style: { 'border-color': c.pathBorder, 'border-width': 4, color: c.pathText, 'z-index': 20 } },
    { selector: 'node.dim', style: { opacity: 0.25 } },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        'line-color': c.edge,
        width: 1.5,
        'target-arrow-shape': 'none',
        'transition-property': 'line-color, width, opacity',
        'transition-duration': `${TRANSITION_MS}ms`,
      },
    },
    { selector: 'edge.path', style: { 'line-color': c.pathEdge, width: 3, 'z-index': 20 } },
    { selector: 'edge.dim', style: { opacity: 0.15 } },
  ];
}

function sortedClasses(element) {
  const classes = element.classes();
  const list = Array.isArray(classes) ? classes : String(classes).split(/\s+/);
  return [...new Set(list.filter(Boolean))].sort();
}

function edgeId(parent, child) {
  return `${parent}->${child}`;
}

export function createRenderer(container, options = {}) {
  const {
    cytoscape,
    start,
    end,
    nodeCap = NODE_CAP,
    hardCap = HARD_CAP,
    reducedMotion = false,
    theme: initialTheme = 'light',
    headless = false,
  } = options;

  if (typeof cytoscape !== 'function') {
    throw new TypeError('createRenderer requires a cytoscape factory');
  }

  const startWord = start ?? null;
  const endWord = end ?? null;
  let theme = initialTheme;
  let destroyed = false;

  const layout = createRadialLayout();

  const drawn = new Set();
  const edgeIds = new Set();
  let hidden = 0;
  let pathDrawn = null;
  let currentWord = null;

  const cy = headless
    ? cytoscape({ headless: true, styleEnabled: false, style: stylesFor(theme), elements: [] })
    : cytoscape({
        container,
        style: stylesFor(theme),
        layout: { name: 'preset' },
        pixelRatio: 1.5,
        textureOnViewport: true,
        hideEdgesOnViewport: true,
        motionBlur: false,
        autoungrabify: true,
        boxSelectionEnabled: false,
        minZoom: 0.05,
        maxZoom: 2.5,
      });

  function addEdge(parent, child) {
    const id = edgeId(parent, child);
    if (edgeIds.has(id) || !drawn.has(parent) || !drawn.has(child)) return;
    cy.add({
      group: 'edges',
      data: { id, source: parent, target: child },
    });
    edgeIds.add(id);
  }

  function addNode(word, parent, statusClass) {
    if (drawn.has(word)) return false;
    if (drawn.size >= nodeCap) {
      hidden++;
      return false;
    }
    if (!layout.positionOf(word)) layout.place(word, parent);
    cy.add({
      group: 'nodes',
      data: { id: word, label: word },
      position: layout.positionOf(word),
      classes: [...(statusClass ? [statusClass] : []), ...startEndClasses(word)].join(' '),
    });
    drawn.add(word);
    if (parent !== null && parent !== undefined && drawn.has(parent)) addEdge(parent, word);
    return true;
  }

  function startEndClasses(word) {
    const classes = [];
    if (word === startWord) classes.push('start');
    if (word === endWord) classes.push('end');
    return classes;
  }

  function removeEdge(parent, child) {
    const id = edgeId(parent, child);
    if (!edgeIds.has(id)) return;
    const element = cy.getElementById(id);
    if (element.nonempty()) element.remove();
    edgeIds.delete(id);
  }

  function onDiscover(event) {
    layout.place(event.word, event.from);
    addNode(event.word, event.from, 'frontier');
  }

  function onReparent(event) {
    if (!drawn.has(event.word)) return;
    if (event.from === null || event.from === undefined || !drawn.has(event.from)) return;
    if (event.prevFrom !== null && event.prevFrom !== undefined && drawn.has(event.prevFrom)) {
      removeEdge(event.prevFrom, event.word);
    }
    addEdge(event.from, event.word);
  }

  function onVisit(event) {
    const previous = currentWord;
    currentWord = event.word;
    if (previous && previous !== event.word && drawn.has(previous)) {
      cy.getElementById(previous).removeClass('current').addClass('visited');
    }
    if (drawn.has(event.word)) {
      cy.getElementById(event.word).removeClass('frontier').addClass('current');
    }
  }

  function drawPath(words, state) {
    const missing = words.filter((word) => !drawn.has(word));
    if (drawn.size + missing.length > hardCap) {
      pathDrawn = false;
      return;
    }

    for (const word of missing) {
      if (!layout.positionOf(word)) {
        const parent = state && typeof state.parentOf === 'function' ? state.parentOf(word) ?? null : null;
        layout.place(word, parent);
      }
      const status = state && typeof state.statusOf === 'function' ? state.statusOf(word) : 'frontier';
      const statusClass = status === 'visited' ? 'visited' : 'frontier';
      cy.add({
        group: 'nodes',
        data: { id: word, label: word },
        position: layout.positionOf(word),
        classes: [statusClass, ...startEndClasses(word)].join(' '),
      });
      drawn.add(word);
    }

    const pathEdgeIds = new Set();
    const pathNodes = new Set(words);
    for (let i = 0; i < words.length - 1; i++) {
      addEdge(words[i], words[i + 1]);
      pathEdgeIds.add(edgeId(words[i], words[i + 1]));
    }

    cy.batch(() => {
      cy.nodes().forEach((node) => {
        if (pathNodes.has(node.id())) node.addClass('path');
        else node.addClass('dim');
      });
      cy.edges().forEach((edge) => {
        if (pathEdgeIds.has(edge.id())) edge.addClass('path');
        else edge.addClass('dim');
      });
    });
    pathDrawn = true;
  }

  function rebuild(state) {
    cy.elements().remove();
    drawn.clear();
    edgeIds.clear();
    hidden = 0;
    pathDrawn = null;
    currentWord = null;

    state.forEachDiscovered((word, parent, depth, status) => {
      void depth;
      layout.place(word, parent);
      addNode(word, parent, status === 'visited' ? 'visited' : 'frontier');
    });

    currentWord = state.current;
    if (currentWord && drawn.has(currentWord)) {
      cy.getElementById(currentWord).removeClass('visited frontier').addClass('current');
    }

    if (state.pathWords) drawPath(state.pathWords, state);
  }

  function apply(change, state) {
    if (destroyed) return;
    if (change.kind === 'forward') {
      for (const event of change.events) {
        if (event.type === 'discover') onDiscover(event);
        else if (event.type === 'reparent') onReparent(event);
        else if (event.type === 'visit') onVisit(event);
        else if (event.type === 'path') drawPath(event.words, state);
      }
    } else if (change.kind === 'backward' || change.kind === 'reset') {
      if (state) rebuild(state);
    }
  }

  function fit() {
    if (destroyed) return;
    if (headless) return;
    if (reducedMotion) {
      cy.fit(undefined, 24);
    } else {
      cy.animate({ fit: { padding: 24 } }, { duration: 200 });
    }
  }

  function setTheme(name) {
    if (destroyed) return;
    theme = name;
    cy.style(stylesFor(theme));
  }

  function counts() {
    return { rendered: drawn.size, hidden, pathDrawn };
  }

  function elements() {
    if (destroyed) return { nodes: [], edges: [] };
    return {
      nodes: cy
        .nodes()
        .map((node) => ({ id: node.id(), classes: sortedClasses(node) }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      edges: cy
        .edges()
        .map((edge) => ({
          source: edge.source().id(),
          target: edge.target().id(),
          classes: sortedClasses(edge),
        }))
        .sort((a, b) => {
          if (a.source !== b.source) return a.source < b.source ? -1 : 1;
          return a.target < b.target ? -1 : 1;
        }),
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    drawn.clear();
    edgeIds.clear();
    if (cy && typeof cy.destroy === 'function') cy.destroy();
  }

  return { apply, fit, setTheme, counts, elements, destroy };
}
