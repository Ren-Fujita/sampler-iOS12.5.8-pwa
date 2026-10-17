// Use native Pointer Events when present. Touch Events retain one id per finger
// and their original target even when a finger moves outside a control.
const mouseOwners = new WeakSet();
let lastTouch = -Infinity;

export function capturePointer(element, id) {
  if (element.setPointerCapture)element.setPointerCapture(id);
}

export function onPointer(element, name, callback) {
  if (typeof window === 'undefined' || window.PointerEvent) {
    element.addEventListener(name, callback);
    return;
  }
  const touchNames = { pointerdown: 'touchstart', pointermove: 'touchmove', pointerup: 'touchend', pointercancel: 'touchcancel' };
  const mouseNames = { pointerdown: 'mousedown', pointermove: 'mousemove', pointerup: 'mouseup' };
  if (touchNames[name])element.addEventListener(touchNames[name], event => {
    lastTouch = Date.now();
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      callback({ pointerId: 'touch-' + touch.identifier, pointerType: 'touch', button: 0,
        clientX: touch.clientX, clientY: touch.clientY, target: event.target,
        preventDefault: () => event.preventDefault() });
    }
  }, { passive: false });
  if (mouseNames[name]) {
    const receiver = name === 'pointerdown' ? element : window;
    receiver.addEventListener(mouseNames[name], event => {
      // Ignore compatibility mouse events generated after a touch.
      if (Date.now() - lastTouch < 800)return;
      if (name === 'pointerdown') {
        if (event.button !== 0)return;
        mouseOwners.add(element);
      } else if (element !== window && !mouseOwners.has(element))return;
      callback({ pointerId: 'mouse', pointerType: 'mouse', button: event.button,
        clientX: event.clientX, clientY: event.clientY, target: event.target,
        preventDefault: () => event.preventDefault() });
      if (name === 'pointerup')mouseOwners.delete(element);
    });
  }
}

// Old WebKit does not orient styled range inputs using writing-mode. Handle
// coordinates directly while keeping the native input for keyboard/VoiceOver.
export function bindLegacyVolume(input, set) {
  if (typeof window === 'undefined' || window.PointerEvent)return;
  input.classList.add('legacy-volume');
  let dragging = null;
  const move = event => {
    if (event.pointerId !== dragging)return;
    event.preventDefault();
    const rect = input.getBoundingClientRect();
    if (rect.height > 0)set(Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height)));
  };
  onPointer(input, 'pointerdown', event => {
    if (dragging !== null)return;
    dragging = event.pointerId;
    input.focus();
    move(event);
  });
  onPointer(input, 'pointermove', move);
  onPointer(input, 'pointerup', event => {
    move(event);
    if (event.pointerId === dragging)dragging = null;
  });
  onPointer(input, 'pointercancel', event => {
    if (event.pointerId === dragging)dragging = null;
  });
  window.addEventListener('blur', () => { dragging = null; });
}
