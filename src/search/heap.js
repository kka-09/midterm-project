/**
 * Minimal binary min-heap with a caller-supplied comparator and in-place
 * update. Shared by greedy best-first (spec 04) and A* (spec 05).
 */
export class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop() {
    const { items } = this;
    const top = items[0];
    const last = items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Replaces the first item matching `predicate` and restores heap order. */
  update(matches, item) {
    const index = this.items.findIndex(matches);
    if (index === -1) return false;
    this.items[index] = item;
    this.siftUp(index);
    this.siftDown(index);
    return true;
  }

  siftUp(index) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.items[i], this.items[parent]) >= 0) break;
      swap(this.items, i, parent);
      i = parent;
    }
  }

  siftDown(index) {
    let i = index;
    const { items } = this;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let best = i;
      if (left < items.length && this.compare(items[left], items[best]) < 0) best = left;
      if (right < items.length && this.compare(items[right], items[best]) < 0) best = right;
      if (best === i) break;
      swap(items, i, best);
      i = best;
    }
  }
}

function swap(items, a, b) {
  const tmp = items[a];
  items[a] = items[b];
  items[b] = tmp;
}
