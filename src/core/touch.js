// Touch controls for phones and tablets, on top of the shell's mouse handling:
//   tap                   show or hide the controls (or carry on, when paused)
//   double tap a side     jump 10 seconds (the skin's own double click)
//   double tap the middle play or pause
//   drag sideways         seek, up to two minutes across the screen
//   drag up or down       volume on the right half, brightness on the left
import { fmt } from './engine.js';

export function enableTouch(engine, stage) {
  const body = document.body;
  const host = window.host;
  let start = null;
  let mode = '';
  let target = 0;
  let lastTap = null;
  let tapTimer = null;
  let brightness = 0.6;

  // The shell acts on mouse clicks and double clicks on the stage; on touch, these gestures do.
  const swallow = e => { if (e.isTrusted && !(e.target.closest && e.target.closest('[data-k-hold]'))) e.stopImmediatePropagation(); };
  stage.addEventListener('click', swallow, true);
  stage.addEventListener('dblclick', swallow, true);

  const hideControls = () => { engine.set({ idle: true }); body.classList.add('k-idle'); };

  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || (e.target.closest && e.target.closest('[data-k-hold]'))) return;
    const r = stage.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, left: r.left, time: engine.currentTime(), volume: engine.state.volume, light: brightness, idle: body.classList.contains('k-idle') };
    mode = '';
  });

  stage.addEventListener('pointermove', e => {
    if (!start || !engine.state.item) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!mode) {
      if (Math.hypot(dx, dy) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) mode = engine.state.duration ? 'seek' : 'none';
      else mode = start.x - start.left > start.w / 2 ? 'volume' : 'light';
      clearTimeout(tapTimer);
      lastTap = null;
    }
    if (mode === 'seek') {
      target = Math.max(0, Math.min(engine.state.duration, start.time + (dx / start.w) * 120));
      const d = target - start.time;
      engine.osd(`${d < 0 ? '-' : '+'}${fmt(Math.abs(d))}   ${fmt(target)}`, d < 0 ? 'rewind' : 'forward');
    } else if (mode === 'volume') {
      engine.setVolume(start.volume - (dy / start.h) * 150);
      engine.osd(`Volume ${engine.state.volume}%`, engine.state.volume ? 'volume' : 'mute');
    } else if (mode === 'light') {
      brightness = Math.max(0.02, Math.min(1, start.light - dy / start.h));
      host.setBrightness(brightness);
      engine.osd(`Brightness ${Math.round(brightness * 100)}%`, 'sun');
    }
  });

  const end = e => {
    if (!start) return;
    const s = start;
    start = null;
    if (mode === 'seek') { engine.seek(target); return; }
    if (mode || e.type === 'pointercancel') return;
    const now = performance.now();
    if (lastTap && now - lastTap.at < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 60) {
      clearTimeout(tapTimer);
      lastTap = null;
      const x = (e.clientX - s.left) / s.w;
      if (x > 0.3 && x < 0.7) engine.toggle();
      else stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
      return;
    }
    lastTap = { at: now, x: e.clientX, y: e.clientY };
    tapTimer = setTimeout(() => {
      lastTap = null;
      if (!engine.state.item) return;
      if (!engine.state.playing) engine.toggle();
      else if (!s.idle) hideControls();
    }, 320);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}
