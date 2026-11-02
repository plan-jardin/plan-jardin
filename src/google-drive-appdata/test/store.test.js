import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReactive } from '../src/reactive.js';
import { AppDataStore, DriveError } from '../src/index.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class FakeFile {
  writes = [];
  failNext = null;
  delayMs = 0;
  async write(json) {
    await tick(this.delayMs);
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.writes.push(JSON.parse(json));
  }
}

test('reactive tracks nested object, array and delete mutations', () => {
  let count = 0;
  const raw = { a: { b: 1 }, list: [] };
  const data = createReactive(raw, () => count++);
  data.a.b = 2;
  data.list.push({ x: 1 });
  data.list[0].x = 5;
  delete data.a.b;
  data.newKey = { deep: true };
  data.newKey.deep = false;
  assert.ok(count >= 6);
  assert.deepEqual(raw, { a: {}, list: [{ x: 5 }], newKey: { deep: false } });
});

test('reactive ignores no-op assignments and stores raw values', () => {
  let count = 0;
  const raw = { a: 1, obj: { v: 1 } };
  const data = createReactive(raw, () => count++);
  data.a = 1;
  assert.equal(count, 0);
  data.copy = data.obj;
  assert.equal(raw.copy, raw.obj);
  assert.equal(data.copy, data.obj);
});

test('store debounces mutations into a single save', async () => {
  const file = new FakeFile();
  const store = new AppDataStore({ file, initialData: { n: 0 }, saveDebounceMs: 20 });
  for (let i = 1; i <= 5; i++) store.data.n = i;
  assert.equal(store.status, 'pending');
  await tick(60);
  assert.deepEqual(file.writes, [{ n: 5 }]);
  assert.equal(store.status, 'idle');
  await store.close();
});

test('flush saves immediately and changes made during a save are saved afterwards', async () => {
  const file = new FakeFile();
  file.delayMs = 20;
  const store = new AppDataStore({ file, initialData: {}, saveDebounceMs: 1000 });
  store.data.a = 1;
  const p = store.flush();
  store.data.b = 2;
  await p;
  await store.flush();
  assert.deepEqual(file.writes, [{ a: 1 }, { a: 1, b: 2 }]);
  assert.equal(store.hasUnsavedChanges, false);
  await store.close();
});

test('retryable failures emit error and are retried', async () => {
  const file = new FakeFile();
  file.failNext = new DriveError(503, 'unavailable');
  const store = new AppDataStore({ file, initialData: {}, saveDebounceMs: 5, retryDelayMs: 20 });
  const errors = [];
  store.addEventListener('error', (e) => errors.push(e.detail));
  store.data.x = 1;
  await tick(80);
  assert.equal(errors.length, 1);
  assert.deepEqual(file.writes, [{ x: 1 }]);
  assert.equal(store.status, 'idle');
  await store.close();
});
