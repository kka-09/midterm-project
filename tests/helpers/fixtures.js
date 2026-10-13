import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDictionary } from '../../src/data.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'fixtures', 'patterns');

export function loadFixture(length) {
  const buckets = JSON.parse(readFileSync(join(fixtureDir, `${length}.json`), 'utf8'));
  return createDictionary(buckets, length);
}

export const fixtureWords = {
  3: ['bat', 'cat', 'cog', 'cot', 'dog', 'dot'],
  4: ['bold', 'bolt', 'card', 'cola', 'cold', 'cord', 'core', 'quiz'],
};
