import { readBlobBuffer } from './file-compat.js';

// Repackage the AAC sound track of ordinary MP4/QuickTime files as an M4A.
// No video decoding, realtime recording, upload, or recent browser APIs needed.
const MAX_METADATA = 16 * 1024 * 1024;
const MAX_ENTRIES = 1000000;
const bad = () => Error('動画の音声情報が壊れているか、対応していない形式です。');
const fragmented = () => Error('この動画の分割形式には対応していません。M4A・MP3・WAVの音声ファイルに変換して取り込んでください。');

function typeAt(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}
function number64(view, offset) {
  const value = view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
  if (!Number.isSafeInteger(value))throw bad();
  return value;
}
function boxes(view, start, end) {
  const result = [];
  let position = start;
  while (position < end) {
    if (end - position < 8)throw bad();
    let size = view.getUint32(position), header = 8;
    if (size === 1) {
      if (end - position < 16)throw bad();
      size = number64(view, position + 8);
      header = 16;
    } else if (size === 0)size = end - position;
    if (size < header || size > end - position)throw bad();
    result.push({ type: typeAt(view, position + 4), start: position, data: position + header, end: position + size });
    position += size;
  }
  return result;
}
function child(view, parent, name, required = true) {
  const found = boxes(view, parent.data, parent.end).filter(box => box.type === name);
  if (found.length > 1 || (required && !found.length))throw bad();
  return found[0];
}
function table(view, box, stride, prefix = 8) {
  if (box.end - box.data < prefix)throw bad();
  const count = view.getUint32(box.data + 4);
  if (count > MAX_ENTRIES || prefix + count * stride !== box.end - box.data)throw bad();
  return count;
}
function makeBox(type, parts) {
  const size = 8 + parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (size > 0xffffffff)throw bad();
  const result = new Uint8Array(size), view = new DataView(result.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i++)result[4 + i] = type.charCodeAt(i);
  let offset = 8;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

export function isVideoFile(file) {
  return /^video\//i.test(file.type || '') || /\.(mp4|mov|m4v|3gp|3g2|webm|avi|mkv)$/i.test(file.name || '');
}

export async function extractVideoAudio(file, { onProgress = () => {} } = {}) {
  const top = [];
  let offset = 0;
  while (offset < file.size) {
    const bytes = await readBlobBuffer(file.slice(offset, Math.min(file.size, offset + 16)));
    if (bytes.byteLength < 8)throw bad();
    const view = new DataView(bytes);
    let size = view.getUint32(0), header = 8;
    if (size === 1) {
      if (bytes.byteLength < 16)throw bad();
      size = number64(view, 8);
      header = 16;
    } else if (size === 0)size = file.size - offset;
    if (size < header || size > file.size - offset)throw bad();
    top.push({ type: typeAt(view, 4), start: offset, data: offset + header, end: offset + size });
    if (top.length > 10000)throw bad();
    offset += size;
  }
  if (top.some(box => box.type === 'moof'))throw fragmented();
  const moovs = top.filter(box => box.type === 'moov');
  const media = top.filter(box => box.type === 'mdat');
  if (moovs.length !== 1 || !media.length)throw bad();
  const moov = moovs[0];
  if (moov.end - moov.start > MAX_METADATA)throw Error('動画の音声情報が大きすぎます。短い動画または音声ファイルを選んでください。');
  const metadata = await readBlobBuffer(file.slice(moov.start, moov.end));
  const view = new DataView(metadata), root = boxes(view, 0, metadata.byteLength)[0];
  const contents = boxes(view, root.data, root.end);
  if (contents.some(box => box.type === 'mvex'))throw fragmented();
  const movie = child(view, root, 'mvhd');
  let selected = null, soundTracks = 0;
  for (const track of contents.filter(box => box.type === 'trak')) {
    const mdia = child(view, track, 'mdia'), handler = child(view, mdia, 'hdlr');
    if (handler.end - handler.data < 12)throw bad();
    if (typeAt(view, handler.data + 8) !== 'soun')continue;
    soundTracks++;
    const minf = child(view, mdia, 'minf'), stbl = child(view, minf, 'stbl');
    const stsd = child(view, stbl, 'stsd');
    if (stsd.end - stsd.data < 8)throw bad();
    const entries = boxes(view, stsd.data + 8, stsd.end);
    if (!entries.length || entries.length !== view.getUint32(stsd.data + 4))throw bad();
    if (entries.some(entry => entry.type === 'enca'))throw Error('保護された動画の音声は取り込めません。');
    if (entries.every(entry => entry.type === 'mp4a')) {
      selected = { track, stbl, descriptions: entries.length };
      break;
    }
  }
  if (!soundTracks)throw Error('この動画には音声トラックがありません。音声付きの動画を選んでください。');
  if (!selected)throw Error('この動画の音声形式には対応していません。AAC音声付きのMP4・MOV、またはM4A・MP3・WAVを選んでください。');

  const { track, stbl, descriptions } = selected;
  const sizes = child(view, stbl, 'stsz'), mapping = child(view, stbl, 'stsc');
  const smallOffsets = child(view, stbl, 'stco', false), largeOffsets = child(view, stbl, 'co64', false);
  if (!!smallOffsets === !!largeOffsets)throw bad();
  const offsets = smallOffsets || largeOffsets, stride = smallOffsets ? 4 : 8;
  const chunkCount = table(view, offsets, stride), mapCount = table(view, mapping, 12);
  if (sizes.end - sizes.data < 12)throw bad();
  const constantSize = view.getUint32(sizes.data + 4), sampleCount = view.getUint32(sizes.data + 8);
  if (!chunkCount || !mapCount || !sampleCount)throw bad();
  if (sampleCount > MAX_ENTRIES || sizes.end - sizes.data !== 12 + (constantSize ? 0 : sampleCount * 4))throw bad();
  const rules = [];
  for (let i = 0; i < mapCount; i++) {
    const base = mapping.data + 8 + i * 12;
    const first = view.getUint32(base), samples = view.getUint32(base + 4), description = view.getUint32(base + 8);
    if (!first || first > chunkCount || !samples || !description || description > descriptions ||
        (!i && first !== 1) || (i && first <= rules[i - 1].first))throw bad();
    rules.push({ first, samples });
  }
  const chunks = [];
  let sample = 0, rule = 0, total = 0;
  for (let i = 0; i < chunkCount; i++) {
    while (rule + 1 < rules.length && rules[rule + 1].first <= i + 1)rule++;
    const count = rules[rule].samples;
    if (count > sampleCount - sample)throw bad();
    let length = 0;
    if (constantSize)length = count * constantSize;
    else for (let j = 0; j < count; j++)length += view.getUint32(sizes.data + 12 + (sample + j) * 4);
    sample += count;
    const position = offsets.data + 8 + i * stride;
    const start = smallOffsets ? view.getUint32(position) : number64(view, position);
    if (!Number.isSafeInteger(length) || length < 1 || !media.some(box => start >= box.data && length <= box.end - start))throw bad();
    chunks.push({ start, length, tablePosition: position, payloadOffset: total });
    total += length;
    if (!Number.isSafeInteger(total) || total > file.size)throw bad();
  }
  if (sample !== sampleCount)throw bad();

  const ftyp = makeBox('ftyp', [Uint8Array.from([77,52,65,32,0,0,0,0,77,52,65,32,105,115,111,109,109,112,52,50])]);
  const trakBytes = new Uint8Array(metadata.slice(track.start, track.end));
  const outputMoov = makeBox('moov', [new Uint8Array(metadata.slice(movie.start, movie.end)), trakBytes]);
  const payloadStart = ftyp.byteLength + outputMoov.byteLength + 8;
  const trakStart = 8 + movie.end - movie.start;
  const rewritten = new DataView(outputMoov.buffer);
  for (const chunk of chunks) {
    const next = payloadStart + chunk.payloadOffset;
    if (next > 0xffffffff)throw bad();
    const position = trakStart + chunk.tablePosition - track.start;
    if (smallOffsets)rewritten.setUint32(position, next);
    else { rewritten.setUint32(position, 0); rewritten.setUint32(position + 4, next); }
  }
  const mdat = new Uint8Array(8), mdatView = new DataView(mdat.buffer);
  if (total + 8 > 0xffffffff)throw bad();
  mdatView.setUint32(0, total + 8);
  mdat.set([109,100,97,116], 4);
  const parts = [ftyp, outputMoov, mdat];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    parts.push(file.slice(chunk.start, chunk.start + chunk.length));
    if (i % 128 === 0) {
      onProgress(i, chunks.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  onProgress(chunks.length, chunks.length);
  return new Blob(parts, { type: 'audio/mp4' });
}
