import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractVideoAudio, isVideoFile } from '../js/video-audio.js';

const fixtures = new URL('fixtures/video/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('expected-aac.json',fixtures),'utf8'));
const file = async name => Object.assign(new Blob([await readFile(new URL(name,fixtures))], { type:name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' }), { name });

function topBoxes(bytes) {
  const view = new DataView(bytes);
  const items = [];
  for (let position=0; position<bytes.byteLength;) {
    const size = view.getUint32(position);
    assert(size >= 8 && position + size <= bytes.byteLength);
    items.push({ type:String.fromCharCode(...new Uint8Array(bytes,position+4,4)), offset:position, size });
    position += size;
  }
  return items;
}

for (const name of ['aac-video.mp4','aac-video.mov']) {
  test('extracts every AAC packet from ' + name + ' without any video payload', async () => {
    const source = await file(name), progress = [];
    const audio = await extractVideoAudio(source,{ onProgress:(done,total) => progress.push([done,total]) });
    const bytes = await audio.arrayBuffer(), boxes = topBoxes(bytes);
    assert.deepEqual(boxes.map(box => box.type), ['ftyp','moov','mdat']);
    const mdat = boxes[2], payload = new Uint8Array(bytes,mdat.offset+8,mdat.size-8);
    assert.equal(payload.byteLength,expected[name].aacPayloadBytes);
    assert.equal(createHash('sha256').update(payload).digest('hex'),expected[name].aacPayloadSha256);
    assert.equal(audio.type,'audio/mp4');
    assert.equal(progress.at(-1)[0],progress.at(-1)[1]);
    assert(!Buffer.from(bytes).includes(Buffer.from('vide')));
    assert(Buffer.from(bytes).includes(Buffer.from('soun')));
  });
}

test('detects videos by MIME type or filename even when Photos omits one', () => {
  assert(isVideoFile({ type:'video/quicktime',name:'unknown' }));
  assert(isVideoFile({ type:'',name:'IMG_0023.MOV' }));
  assert(isVideoFile({ name:'clip.mp4' }));
  assert(!isVideoFile({ type:'audio/wav',name:'sound.wav' }));
});

test('distinguishes silent videos and fragmented MP4 with actionable errors', async () => {
  await assert.rejects(extractVideoAudio(await file('no-audio.mp4')), /音声トラックがありません/);
  await assert.rejects(extractVideoAudio(await file('fragmented.mp4')), /分割形式/);
});

test('truncated and corrupt metadata never return a replacement sound', async () => {
  const original = new Uint8Array(await (await file('aac-video.mp4')).arrayBuffer());
  await assert.rejects(extractVideoAudio(new Blob([original.slice(0,40)])), /壊れている/);
  const damaged = original.slice(), at = Buffer.from(damaged).lastIndexOf('stco');
  assert(at > 0);
  new DataView(damaged.buffer).setUint32(at+12,0xffffff00);
  await assert.rejects(extractVideoAudio(new Blob([damaged])), /壊れている/);
});

test('rejects an unsupported or protected sound track before decoding', async () => {
  for (const [type,message] of [['sowt',/音声形式には対応/],['enca',/保護された/]]) {
    const original = new Uint8Array(await (await file('aac-video.mp4')).arrayBuffer());
    const at = Buffer.from(original).indexOf('mp4a');
    original.set(Buffer.from(type),at);
    await assert.rejects(extractVideoAudio(new Blob([original])),message);
  }
});

test('rejects unsafe extended-size boxes before allocating metadata', async () => {
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  view.setUint32(0,1); bytes.set(Buffer.from('moov'),4); view.setUint32(8,0x200000);
  await assert.rejects(extractVideoAudio(new Blob([bytes])), /壊れている/);
});
