// 🛟 01/10 — sw.js : le repli hors-ligne ATTEND le cache (plus jamais respondWith(undefined)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('aucun « return caches.match(...) || … » non attendu ; repli 503 garanti', () => {
  assert.doesNotMatch(sw, /return caches\.match\([^)]*\) \|\|/);
  assert.equal((sw.match(/return \(await caches\.match\(BASE\)\) \|\| new Response\('Offline', \{ status: 503 \}\);/g) || []).length, 2);
  assert.match(sw, /const CACHE_VERSION = '2\.2\.1';/);
});
