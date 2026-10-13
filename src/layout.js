/**
 * Spec 07 - Radial layout. A pure, deterministic placement function: the
 * start sits at the origin and a word at depth d sits on a ring of radius
 * d * ringGap. It knows nothing about rendering or caps.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPREAD = 1.1;
const NUDGE = 0.0007;

function polar(angle, radius) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function fanOffset(index) {
  return Math.ceil(index / 2) * (index % 2 === 1 ? 1 : -1);
}

export function createRadialLayout({ ringGap = 56 } = {}) {
  const positions = new Map();
  const angles = new Map();
  const depths = new Map();
  const childCounts = new Map();
  const occupied = new Set();

  function place(word, parent) {
    if (positions.has(word)) return positions.get(word);

    let depth;
    let angle;
    if (parent === null || parent === undefined) {
      depth = 0;
      angle = 0;
    } else {
      if (!depths.has(parent)) place(parent, null);
      depth = depths.get(parent) + 1;
      const index = childCounts.get(parent) ?? 0;
      childCounts.set(parent, index + 1);
      if (depth === 1) {
        angle = index * GOLDEN_ANGLE;
      } else {
        angle = angles.get(parent) + fanOffset(index) * (SPREAD / depth);
      }
    }

    const radius = depth * ringGap;
    let position = polar(angle, radius);
    let guard = 0;
    while (occupied.has(`${position.x},${position.y}`) && guard < 10000) {
      angle += NUDGE;
      position = polar(angle, radius);
      guard++;
    }

    positions.set(word, position);
    angles.set(word, angle);
    depths.set(word, depth);
    occupied.add(`${position.x},${position.y}`);
    return position;
  }

  function positionOf(word) {
    return positions.get(word);
  }

  return { place, positionOf };
}
