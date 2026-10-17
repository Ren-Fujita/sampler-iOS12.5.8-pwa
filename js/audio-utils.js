export function createChain(context, destination, master){
  const input = context.createGain(),
  output = context.createGain(),
  volume = context.createGain(),
  limiter = context.createDynamicsCompressor();
  limiter.threshold.value = - 5;
  limiter.knee.value = 8;
  limiter.ratio.value = 8;
  limiter.attack.value = .003;
  limiter.release.value = .1;
  input.connect(output);
  output.connect(limiter);
  limiter.connect(volume);
  volume.connect(destination);
  volume.gain.value = master;
  return {
    input,
    output,
    master: volume
  }
}

// iOS 12 WebKit decodes through callbacks. Passing callbacks also works on
// current browsers; consume any returned promise rejection without decoding twice.
export function decodeAudio(context, bytes, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(Error('音声の読み込みが完了しませんでした。短い動画またはM4A・MP3・WAVで試してください。')), timeoutMs);
    const success = result => { clearTimeout(timer); resolve(result); };
    const fail = error => { clearTimeout(timer); reject(error || Error('音声を読み込めませんでした。')); };
    try {
      const result = context.decodeAudioData(bytes, success, fail);
      if (result && typeof result.then === 'function')result.then(success, fail);
    } catch (error) {
      fail(error);
    }
  });
}

const unlockedContexts = new WeakSet();
export function unlockAudio(context) {
  if (unlockedContexts.has(context) && context.state === 'running')return;
  // Start synchronously in the trusted click/touch handler, before any await.
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
  source.connect(context.destination);
  source.onended = () => source.disconnect();
  source.start(0);
  unlockedContexts.add(context);
}

// Older WebKit may return no promise, or change state after resume resolves.
// Invoke resume immediately in the caller's user gesture, then wait for state.
export function resumeAudioContext(context, { timeoutMs = 2500 } = {}) {
  if (context.state === 'running')return Promise.resolve(context);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled)return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (context.removeEventListener)context.removeEventListener('statechange', check);
      if (error)reject(error);
      else resolve(context);
    };
    const check = () => {
      if (context.state === 'running')finish();
      else if (context.state === 'closed')finish(Error('音声が閉じられました。「音声を復旧」を押してください。'));
    };
    const timer = setTimeout(() => finish(Error('音を有効にできませんでした。「再生」をタップするか、メニューの「音声を復旧」を押してください。')), timeoutMs);
    const poll = setInterval(check, 25);
    if (context.addEventListener)context.addEventListener('statechange', check);
    try {
      const result = context.resume();
      if (result && typeof result.then === 'function')result.then(check, finish);
      check();
    } catch (error) { finish(error); }
  });
}
export function configurePlaybackSession(){
  try{
    const session = navigator.audioSession;
    if (session){
      if (session.type !== 'playback')session.type = 'playback';
      return session.type === 'playback'
    }
  }catch{
  }
  return false
}
