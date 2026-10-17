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
export function decodeAudio(context, bytes) {
  return new Promise((resolve, reject) => {
    try {
      const result = context.decodeAudioData(bytes, resolve, reject);
      if (result && typeof result.then === 'function')result.then(resolve, reject);
    } catch (error) {
      reject(error);
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
