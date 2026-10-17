// Older iOS routes Web Audio through the ringer channel. A silent HTML media
// element can request the media channel when Audio Session API is unavailable.
// This is a WebKit workaround, not a guarantee about system mute or volume.
export function createMediaUnlock({ getNavigator, getDocument, idleMs = 1500 }) {
  let element = null, idleTimer = null;
  function keepAlive() {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  function pause() {
    keepAlive();
    if (element)element.pause();
  }
  function start(nativePlayback) {
    keepAlive();
    const nav = getNavigator();
    const ios = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (/Mac/.test(nav.platform || '') && nav.maxTouchPoints > 1);
    if (nativePlayback || !ios) { pause(); return Promise.resolve(false); }
    if (!element) {
      const doc = getDocument();
      element = doc.createElement('audio');
      element.src = './audio/silence.wav';
      element.loop = true;
      element.preload = 'auto';
      element.setAttribute('playsinline', '');
      element.setAttribute('webkit-playsinline', '');
      element.setAttribute('aria-hidden', 'true');
      element.className = 'sr-only';
      doc.body.appendChild(element);
    }
    if (!element.paused)return Promise.resolve(true);
    try {
      // Do not await before calling play(): this must use the trusted gesture.
      return Promise.resolve(element.play()).then(() => true, () => false);
    } catch (error) { return Promise.resolve(false); }
  }
  function idle() {
    if (!element || element.paused || idleTimer !== null)return;
    idleTimer = setTimeout(pause, idleMs);
  }
  return { start, pause, idle, keepAlive };
}
