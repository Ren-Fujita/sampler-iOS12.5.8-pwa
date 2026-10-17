import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeAudio, resumeAudioContext } from '../js/audio-utils.js';
import { createMediaUnlock } from '../js/media-unlock.js';
import { bindLegacyVolume } from '../js/input-compat.js';

test('resume waits for running state even with no returned promise', async () => {
  const context = { state:'suspended',resume() { setTimeout(() => { this.state='running'; },1); } };
  assert.equal(await resumeAudioContext(context),context);
});
test('resume waits when a promise resolves before the state change', async () => {
  const context = { state:'interrupted',resume() { setTimeout(() => { this.state='running'; },2); return Promise.resolve(); } };
  assert.equal(await resumeAudioContext(context),context);
});
test('resume failures and stalled decoding end with a visible error', async () => {
  await assert.rejects(resumeAudioContext({ state:'suspended',resume() {} },{ timeoutMs:5 }), /音を有効にできません/);
  await assert.rejects(resumeAudioContext({ state:'suspended',resume() { throw Error('denied'); } }), /denied/);
  await assert.rejects(decodeAudio({ decodeAudioData() {} },new ArrayBuffer(1),{ timeoutMs:5 }), /読み込みが完了しません/);
});
function environment(play) {
  const effects = [];
  const audio = { paused:true,setAttribute() {},play() { this.paused=false; effects.push('play'); return play && play(); },pause() { this.paused=true; effects.push('pause'); } };
  const helper = createMediaUnlock({ getNavigator:() => ({ userAgent:'iPhone OS 12_5_8',platform:'iPhone' }),
    getDocument:() => ({ createElement:() => audio,body:{ appendChild:() => effects.push('append') } }),idleMs:5 });
  return { helper,audio,effects };
}
test('iOS media unlock starts synchronously, reuses one element and releases it on idle', async () => {
  const e = environment();
  const started = e.helper.start(false);
  assert.deepEqual(e.effects,['append','play']);
  assert.equal(await started,true);
  await e.helper.start(false);
  assert.deepEqual(e.effects,['append','play']);
  assert.equal(e.audio.loop,true);
  e.helper.idle();
  e.helper.keepAlive();
  await delay(15);
  assert.equal(e.audio.paused,false);
  e.helper.idle();
  await delay(15);
  assert.equal(e.audio.paused,true);
});
test('native audio sessions need no silent media; media rejection is not a false success', async () => {
  const e = environment(() => Promise.reject(Error('NotAllowedError')));
  assert.equal(await e.helper.start(true),false);
  assert.deepEqual(e.effects,[]);
  assert.equal(await e.helper.start(false),false);
  e.helper.pause();
});
test('vertical volume also binds with Pointer Events on Safari 13 through 17.3', () => {
  const listeners = new Map(),values = [],captured=[];
  globalThis.window = { PointerEvent:function () {},addEventListener() {} };
  const input = { classList:{ add() {} },focus() {},setPointerCapture:id => captured.push(id),
    getBoundingClientRect:() => ({ bottom:110,height:100 }),addEventListener:(name,callback) => listeners.set(name,callback) };
  try {
    bindLegacyVolume(input,value => values.push(value));
    const event = { pointerId:17,button:0,clientY:72.5,preventDefault() {} };
    listeners.get('pointerdown')(event);
    listeners.get('pointermove')({ ...event,clientY:10 });
    listeners.get('pointerup')({ ...event,clientY:110 });
    assert.deepEqual(values,[.375,1,0]);
    assert.deepEqual(captured,[17]);
  } finally { delete globalThis.window; }
});
