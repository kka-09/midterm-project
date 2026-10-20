import { NODE_CAP, HARD_CAP } from './config.js';
import { createRadialLayout } from './layout.js';

/**
 * Spec 07 - Graph renderer. Applies replay changes to a Cytoscape instance.
 * It contains no algorithm logic; all state comes from the replay engine.
 */

const TRANSITION_MS = 60;

const PALETTE = {
  light: {
    background: '#f8fafc',
    node: '#ffffff',
    nodeBorder: '#94a3b8',
    text: '#0f172a',
    visited: '#dbeafe',
    visitedBorder: '#3b82f6',
    current: '#fef3c7',
    currentBorder: '#d97706',
    currentText: '#92400e',
    startBorder: '#10b981',
    startBg: '#ecfdf5',
    startText: '#065f46',
    endBorder: '#f43f5e',
    endBg: '#fff1f2',
    endText: '#9f1239',
    pathBorder: '#8b5cf6',
    pathBg: '#f3e8ff',
    pathText: '#581c87',
    edge: '#cbd5e1',
    pathEdge: '#8b5cf6',
  },
  dark: {
    background: '#0b0f19',
    node: '#1e293b',
    nodeBorder: '#475569',
    text: '#f8fafc',
    visited: '#1e3a5f',
    visitedBorder: '#60a5fa',
    current: '#451a03',
    currentBorder: '#fbbf24',
    currentText: '#fef3c7',
    startBorder: '#34d399',
    startBg: '#064e3b',
    startText: '#a7f3d0',
    endBorder: '#fb7185',
    endBg: '#881337',
    endText: '#fecdd3',
    pathBorder: '#c084fc',
    pathBg: '#581c87',
    pathText: '#f3e8ff',
    edge: '#334155',
    pathEdge: '#c084fc',
  },
};

function stylesFor(theme) {
  const c = PALETTE[theme] ?? PALETTE.light;
  return [
    {
      selector: 'node',
      style: {
        shape: 'ellipse',
        label: 'data(label)',
        'background-color': c.node,
        'border-color': c.nodeBorder,
        'border-width': 2,
        color: c.text,
        'font-family': "'JetBrains Mono', 'Segoe UI Mono', ui-monospace, monospace",
        'font-size': 11,
        'font-weight': '600',
        'text-valign': 'center',
        'text-halign': 'center',
        width: 30,
        height: 30,
        'min-zoomed-font-size': 7,
        'transition-property': 'background-color, border-color, border-width, opacity, width, height',
        'transition-duration': `${TRANSITION_MS}ms`,
      },
    },
    {
      selector: 'node.start',
      style: {
        shape: 'round-rectangle',
        'border-color': c.startBorder,
        'border-width': 3.5,
        'background-color': c.startBg ?? c.node,
        color: c.startText ?? c.text,
        width: 34,
        height: 34,
        'z-index': 15,
      },
    },
    {
      selector: 'node.end',
      style: {
        shape: 'diamond',
        'border-color': c.endBorder,
        'border-width': 3.5,
        'background-color': c.endBg ?? c.node,
        color: c.endText ?? c.text,
        width: 34,
        height: 34,
        'z-index': 15,
      },
    },
    {
      selector: 'node.frontier',
      style: {
        'background-color': 'transparent',
        'border-color': c.nodeBorder,
        'border-style': 'dashed',
        'border-width': 1.8,
      },
    },
    {
      selector: 'node.visited',
      style: {
        'background-color': c.visited,
        'border-color': c.visitedBorder,
        'border-width': 2,
      },
    },
    {
      selector: 'node.current',
      style: {
        'background-color': c.current,
        'border-color': c.currentBorder,
        'border-width': 4,
        color: c.currentText ?? c.text,
        width: 38,
        height: 38,
        'z-index': 30,
      },
    },
    {
      selector: 'node.path',
      style: {
        'border-color': c.pathBorder,
        'background-color': c.pathBg ?? c.node,
        'border-width': 4,
        color: c.pathText,
        width: 36,
        height: 36,
        'z-index': 25,
      },
    },
    { selector: 'node.dim', style: { opacity: 0.18 } },
    {
      selector: 'edge',
      style: {
        'curve-style': 'bezier',
        'line-color': c.edge,
        width: 1.8,
        'target-arrow-shape': 'none',
        'transition-property': 'line-color, width, opacity',
        'transition-duration': `${TRANSITION_MS}ms`,
      },
    },
    { selector: 'edge.path', style: { 'line-color': c.pathEdge, width: 3.8, 'z-index': 20 } },
    { selector: 'edge.dim', style: { opacity: 0.12 } },
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
        minZoom: 0.1,
        maxZoom: 3,
      });

  function centerStart() {
    if (headless || !container) return;
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 400;
    cy.pan({ x: w / 2, y: h / 2 });
    cy.zoom(1.1);
  }
  centerStart();

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

    // Ensure the start node is immediately centered upon creation
    if (drawn.size === 1 && !headless) {
      const firstEle = cy.getElementById(word);
      if (firstEle && firstEle.nonempty()) {
        cy.center(firstEle);
      }
    }
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
    if (!headless && cy.elements('.path').length > 0) {
      if (reducedMotion) {
        cy.fit(cy.elements('.path'), 48);
      } else {
        cy.animate({ fit: { eles: cy.elements('.path'), padding: 48 } }, { duration: 400 });
      }
    }
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
      const applyAll = () => {
        for (const event of change.events) {
          if (event.type === 'discover') onDiscover(event);
          else if (event.type === 'reparent') onReparent(event);
          else if (event.type === 'visit') onVisit(event);
          else if (event.type === 'path') drawPath(event.words, state);
        }
      };
      if (typeof cy.batch === 'function') {
        cy.batch(applyAll);
      } else {
        applyAll();
      }
    } else if (change.kind === 'backward' || change.kind === 'reset') {
      if (state) rebuild(state);
    }
  }

  function fit(target = null, padding = 36) {
    if (destroyed || headless) return;
    const targetEles = target ? (typeof target === 'string' ? cy.getElementById(target) : target) : null;
    const eles = targetEles && targetEles.nonempty && targetEles.nonempty() ? targetEles : cy.elements();

    if (eles.length === 0) {
      centerStart();
      return;
    }

    if (eles.length === 1 && eles.isNode()) {
      if (reducedMotion) {
        cy.center(eles);
        cy.zoom(1.15);
      } else {
        cy.animate({ center: { eles }, zoom: 1.15 }, { duration: 250 });
      }
      return;
    }

    if (reducedMotion) {
      cy.fit(eles, padding);
    } else {
      cy.animate({ fit: { eles, padding } }, { duration: 250 });
    }
  }

  function centerOn(word, animate = false) {
    if (destroyed || headless || !word) return;
    const ele = cy.getElementById(word);
    if (ele && ele.nonempty && ele.nonempty()) {
      if (!animate || reducedMotion) {
        cy.center(ele);
      } else {
        cy.animate({ center: { eles: ele } }, { duration: 150 });
      }
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

  return { apply, fit, centerOn, setTheme, counts, elements, destroy };
}
