// The video surface on Android, with the same interface as video.js. libVLC draws the picture
// natively under the page, so while it plays the page is see-through and only reports where the
// stage is. When the picture needs to be a thing on the page (the held pause, where it becomes a
// photograph that moves), the current frame is fetched once and drawn onto this canvas instead.
// A small glimpse every second or so stands in for VLC's frames for scene colour and bar measuring.

const ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '21:9': 21 / 9, '1:1': 1, '2.39:1': 2.39, '5:4': 1.25 };

export function createNativeSurface(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'k-video';
  const ctx = canvas.getContext('2d');
  const glimpse = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
  const gctx = glimpse.getContext('2d', { willReadFrequently: true });
  const root = document.documentElement;
  const view = { aspect: 'auto', zoom: 1, displayAspect: 16 / 9, trim: false };

  let hasFrame = false;
  let still = null;         // the frozen frame while paused
  let live = false;         // the native picture is what the viewer sees
  let wantLive = false;
  let bars = null;
  let color = null;
  let placed = '';
  let steady = 0;
  let lastRect = '';
  let stillSeq = 0;

  // Black bars baked into the picture, measured on the glimpse (same rule as video.js).
  function measureBars(w, h) {
    const d = gctx.getImageData(0, 0, w, h).data;
    const row = y => { let s = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; } return s / w; };
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    color = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    if (row(h >> 1) < 26) return;
    let top = 0, bottom = 0;
    while (top < h * 0.3 && row(top) < 24) top++;
    while (bottom < h * 0.3 && row(h - 1 - bottom) < 24) bottom++;
    const t = top / h < 0.012 ? 0 : top / h;
    const bt = bottom / h < 0.012 ? 0 : bottom / h;
    bars = bars ? { top: Math.min(bars.top, t), bottom: Math.min(bars.bottom, bt) } : { top: t, bottom: bt };
  }
  const load = url => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = url; });
  async function takeGlimpse(src) {
    const img = typeof src === 'string' ? await load(src) : src;
    if (!img) return;
    glimpse.width = 160;
    glimpse.height = Math.max(2, Math.round(160 * img.height / img.width));
    gctx.drawImage(img, 0, 0, glimpse.width, glimpse.height);
    hasFrame = true;
    measureBars(glimpse.width, glimpse.height);
  }
  host.onGlimpse(url => { if (live) takeGlimpse(url); });

  function setLive(on) {
    live = on;
    root.classList.toggle('k-native-live', on);
    if (on) still = null;
    draw();
  }

  // Fetch the frame on screen now and show it in place of the native picture.
  let freezing = null;
  const freeze = () => freezing || (freezing = grabStill().finally(() => { freezing = null; }));
  async function grabStill() {
    const seq = ++stillSeq;
    const url = await host.grabStill();
    if (seq !== stillSeq || wantLive) return;
    const img = url && await load(url);
    if (seq !== stillSeq || wantLive || !img) return;
    still = img;
    await takeGlimpse(img);
    setLive(false);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.clearRect(0, 0, cw, ch);
    if (live || !still) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const trimmed = view.trim && bars ? 1 - bars.top - bars.bottom : 1;
    const target = ASPECTS[view.aspect] || view.displayAspect / trimmed;
    let w, h;
    if (view.aspect === 'fill') { w = cw; h = ch; }
    else {
      const box = cw / ch;
      if ((target > box) !== (view.aspect === 'crop')) { w = cw; h = cw / target; } else { h = ch; w = ch * target; }
    }
    w *= view.zoom;
    h *= view.zoom;
    const sy = view.trim && bars ? bars.top * still.height : 0;
    ctx.drawImage(still, 0, sy, still.width, still.height * trimmed, (cw - w) / 2, (ch - h) / 2, w, h);
  }
  new ResizeObserver(draw).observe(canvas);

  // Keep the native picture under the stage. Going live waits until the stage has stopped moving
  // (the photograph flies back to full size first), so the native view never chases an animation.
  function track() {
    requestAnimationFrame(track);
    if (!canvas.isConnected) return;
    const r = canvas.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    steady = key === lastRect ? steady + 1 : 0;
    lastRect = key;
    if (wantLive && !live && steady >= 8) setLive(true);
    if (live && steady >= 1 && key !== placed) { placed = key; host.placeVideo(r.left, r.top, r.width, r.height); }
  }
  requestAnimationFrame(track);

  let refreshTimer = null;
  return {
    canvas,
    native: true,
    // The glimpse, for ambient glows that copy the picture.
    get source() { return glimpse; },
    pushFrame() {},
    clear() { hasFrame = false; still = null; bars = null; color = null; stillSeq++; draw(); },
    get bars() { return bars; },
    setTrim(on) { view.trim = !!on; draw(); },
    contentAspect() { return bars ? view.displayAspect / Math.max(0.3, 1 - bars.top - bars.bottom) : view.displayAspect; },
    get hasFrame() { return hasFrame; },
    setView(patch) {
      Object.assign(view, patch);
      host.setVideoView(view.aspect, view.zoom);
      draw();
    },
    setGeometry({ width, height, sarNum, sarDen }) {
      if (width && height) {
        const sar = sarNum && sarDen ? sarNum / sarDen : 1;
        view.displayAspect = (width * sar) / height;
        hasFrame = true;
      }
      draw();
    },
    sampleColor() { return color; },
    snapshotDataUrl(type = 'image/jpeg') { return still ? canvas.toDataURL(type, 0.85) : null; },
    // Resolves once the frame on screen has been frozen onto the page, so a skin can animate it.
    freeze() { return Promise.race([freeze(), new Promise(r => setTimeout(r, 600))]); },
    // Follows playback: live while playing, a still while paused, a fresh still after a paused seek.
    sync(s, keys) {
      const want = !!(s.item && !s.item.isAudio && (s.playing || s.status === 'opening' || s.status === 'buffering'));
      if (want !== wantLive) {
        wantLive = want;
        if (want) { stillSeq++; steady = 0; if (!still) setLive(true); }
        else if (s.item && !s.item.isAudio && hasFrame) freeze();
        else setLive(false);
      }
      if (!want && still && keys.has('time')) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { if (!wantLive) freeze(); }, 250);
      }
      if (keys.has('item') && !s.item) setLive(false);
    },
  };
}
