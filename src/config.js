export const SUPPORTED_LENGTHS = [3, 4, 5, 6];
export const SEARCH_MAX_VISITS = 50000;

// Renderer caps (spec 07).
export const NODE_CAP = 300;
export const HARD_CAP = 600;

// Replay engine limits (spec 06).
export const MAX_EVENTS_PER_TICK = 24;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 240;

// UI playback speeds in events per second (spec 08).
export const SPEED_STOPS = [1, 2, 4, 8, 16, 32, 64];
export const DEFAULT_SPEED = 4;

// Example pairs, verified against the real patterns/ data (spec 08, UI-11/UI-6).
export const EXAMPLES = [
  { start: 'cat', end: 'mau' },
  { start: 'kata', end: 'bola' },
  { start: 'makan', end: 'rumah' },
  { start: 'pulang', end: 'datang' },
];
