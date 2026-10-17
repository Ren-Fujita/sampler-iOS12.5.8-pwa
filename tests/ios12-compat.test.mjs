import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readBlobBuffer, readBlobText } from '../js/file-compat.js';
import { decodeAudio, unlockAudio } from '../js/audio-utils.js';
import { onPointer, bindLegacyVolume } from '../js/input-compat.js';
import { createBackupCodec } from '../js/backup-codec.js';
import { parseSessionSettings } from '../js/session.js';
import { openSessionDatabase, readSession, writeSession } from '../js/session-storage.js';

const nativeRead = Blob.prototype.arrayBuffer;
class OldBlob extends Blob {
  arrayBuffer = undefined;
  text = undefined;
  slice(...args) { return new OldBlob([super.slice(...args)]); }
}
class Reader {
  readAsArrayBuffer(blob) {
    nativeRead.call(blob).then(value => { this.result = value; this.onload(); });
  }
  readAsText(blob) {
    nativeRead.call(blob).then(value => { this.result = new TextDecoder().decode(value); this.onload(); });
  }
}

test('FileReader fallback preserves UTF-8 and bounded binary slices', async () => {
  globalThis.FileReader = Reader;
  try {
    const blob = new OldBlob(['音源名: テスト']);
    assert.equal(await readBlobText(blob), '音源名: テスト');
    const binary = new OldBlob([Uint8Array.of(0, 127, 128, 255)]);
    assert.deepEqual([...new Uint8Array(await readBlobBuffer(binary.slice(1, 3)))], [127, 128]);
  } finally { delete globalThis.FileReader; }
});

test('binary and legacy backups restore without Blob.arrayBuffer or Blob.text', async () => {
  globalThis.FileReader = Reader;
  try {
    const codec = createBackupCodec({ prepareSettings: parseSessionSettings });
    for (const filename of ['before-refactor.sx12', 'legacy-backup.json']) {
      const bytes = await readFile(new URL('fixtures/' + filename, import.meta.url));
      const result = await codec.readBackup(new OldBlob([bytes]));
      assert.equal(result.settings.pads.length, 120);
      assert(result.sounds.some(sound => sound && sound.channels[0].length > 0));
      const backup = await codec.createBinaryBackup(result.settings, result.sounds.map(audio => ({ audio })));
      const restored = await codec.readBackup(new OldBlob([backup]));
      assert.deepEqual(restored.sounds, result.sounds);
      assert.deepEqual(restored.settings, result.settings);
    }
  } finally { delete globalThis.FileReader; }
});

test('FileReader failure and cancellation reject instead of freezing', async () => {
  try {
    globalThis.FileReader = class { readAsArrayBuffer() { this.error = Error('unreadable'); this.onerror(); } };
    await assert.rejects(readBlobBuffer(new OldBlob()), /unreadable/);
    globalThis.FileReader = class { readAsText() { this.onabort(); } };
    await assert.rejects(readBlobText(new OldBlob()), /中止/);
  } finally { delete globalThis.FileReader; }
});

test('callback-only audio decode resolves and propagates decode failures', async () => {
  const bytes = new ArrayBuffer(8), decoded = { length: 16 };
  const context = { decodeAudioData(data, success) { assert.equal(data, bytes); success(decoded); } };
  assert.equal(await decodeAudio(context, bytes), decoded);
  await assert.rejects(decodeAudio({ decodeAudioData(data, success, fail) { fail(Error('bad audio')); } }, bytes), /bad audio/);
  await assert.rejects(decodeAudio({ decodeAudioData() { throw Error('synchronous error'); } }, bytes), /synchronous/);
});

test('audio unlock starts synchronously and retries suspended contexts', () => {
  let starts = 0;
  const context = { state: 'running', sampleRate: 44100, destination: {},
    createBuffer: () => ({}), createBufferSource: () => ({ connect() {}, disconnect() {}, start() { starts++; } }) };
  unlockAudio(context);
  assert.equal(starts, 1);
  unlockAudio(context);
  assert.equal(starts, 1);
  context.state = 'suspended';
  unlockAudio(context);
  assert.equal(starts, 2);
});

function source() {
  const listeners = new Map();
  return { listeners, addEventListener(name, callback) {
    if (!listeners.has(name))listeners.set(name, []);
    listeners.get(name).push(callback);
  }, emit(name, event) { for (const callback of listeners.get(name) || [])callback(event); } };
}
function touches(...ids) {
  return { changedTouches: ids.map(identifier => ({ identifier, clientX: 20, clientY: 35 })), preventDefault() {} };
}

test('fallback tracks multiple fingers, cancellation, and ignores synthetic mouse events', () => {
  const browser = source(), button = source(), held = new Set();
  globalThis.window = browser;
  try {
    onPointer(button, 'pointerdown', event => held.add(event.pointerId));
    onPointer(button, 'pointerup', event => held.delete(event.pointerId));
    onPointer(button, 'pointercancel', event => held.delete(event.pointerId));
    button.emit('touchstart', touches(1, 9));
    assert.deepEqual([...held], ['touch-1', 'touch-9']);
    button.emit('touchend', touches(1));
    assert.deepEqual([...held], ['touch-9']);
    button.emit('touchcancel', touches(9));
    assert.equal(held.size, 0);
    button.emit('mousedown', { button: 0 });
    assert.equal(held.size, 0);
  } finally { delete globalThis.window; }
});

test('legacy vertical volume reaches both endpoints and cancels drags', () => {
  globalThis.window = source();
  const input = { ...source(), classList: { add() {} }, focus() {},
    getBoundingClientRect: () => ({ bottom: 110, height: 100 }) };
  const values = [];
  try {
    bindLegacyVolume(input, value => values.push(value));
    const event = y => ({ changedTouches: [{ identifier: 3, clientY: y }], preventDefault() {} });
    input.emit('touchstart', event(110));
    input.emit('touchmove', event(72.5));
    input.emit('touchmove', event(10));
    input.emit('touchcancel', event(10));
    input.emit('touchmove', event(50));
    assert.deepEqual(values, [0, .375, 1]);
  } finally { delete globalThis.window; }
});

test('modern browsers retain native Pointer Events without fallback listeners', () => {
  globalThis.window = { PointerEvent: function () {} };
  try {
    const button = source(), callback = () => {};
    onPointer(button, 'pointerdown', callback);
    assert.equal(button.listeners.get('pointerdown')[0], callback);
    assert.equal(button.listeners.size, 1);
  } finally { delete globalThis.window; }
});

test('unavailable, blocked and stalled IndexedDB never leave startup pending', async () => {
  delete globalThis.indexedDB;
  await assert.rejects(openSessionDatabase({ timeoutMs: 10 }), /indexedDB/);
  let request;
  globalThis.indexedDB = { open() { request = {}; return request; } };
  try {
    await assert.rejects(openSessionDatabase({ timeoutMs: 10 }), /応答/);
    let closed = false;
    request.result = { close() { closed = true; } };
    request.onsuccess();
    assert.equal(closed, true);
    const blocked = openSessionDatabase({ timeoutMs: 100 });
    request.onblocked();
    await assert.rejects(blocked, /別の画面/);
  } finally { delete globalThis.indexedDB; }
});

test('stalled IndexedDB reads and writes abort with an actionable failure', async () => {
  let aborts = 0;
  const transaction = { abort() { aborts++; }, objectStore: () => ({ get: () => ({}), getAll: () => ({}), put() {} }) };
  const database = { transaction: () => transaction };
  await assert.rejects(readSession(database, { timeoutMs: 10 }), /応答/);
  await assert.rejects(writeSession(database, {}, [], [], { timeoutMs: 10 }), /応答/);
  assert.equal(aborts, 2);
});
