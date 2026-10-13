import { runBfs } from './bfs.js';
import { runGreedy } from './greedy.js';
import { runAstar } from './astar.js';
import { SearchInputError } from './errors.js';

export { SearchInputError };

export const algorithms = {
  bfs: { id: 'bfs', label: 'Breadth-first', frontierMode: 'fifo', guarantee: 'shortest', run: runBfs },
  greedy: { id: 'greedy', label: 'Greedy best-first', frontierMode: 'priority-h', guarantee: 'any', run: runGreedy },
  astar: { id: 'astar', label: 'A*', frontierMode: 'priority-f', guarantee: 'shortest', run: runAstar },
};

export const DEFAULT_ALGORITHM = 'bfs';

export function runSearch(id, dict, start, end, options = {}) {
  const algorithm = algorithms[id];
  if (!algorithm) {
    throw new Error(`Unknown algorithm: ${id}`);
  }
  return algorithm.run(dict, start, end, options);
}
