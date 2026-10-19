// Paints I420 frames from the VLC engine onto a WebGL canvas, letterboxed per aspect mode.

const VERT = `#version 300 es
in vec2 pos;
uniform vec4 rect;      // x, y, w, h in clip space
uniform vec2 crop;      // visible fraction of the decoded frame
uniform vec2 off;       // where the visible part starts (used to trim letterbox bars)
out vec2 uv;
void main() {
  uv = off + vec2((pos.x * 0.5 + 0.5) * crop.x, (0.5 - pos.y * 0.5) * crop.y);
  gl_Position = vec4(rect.x + (pos.x * 0.5 + 0.5) * rect.z, rect.y + (pos.y * 0.5 + 0.5) * rect.w, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D ty, tu, tv;
uniform int bt709;
out vec4 color;
void main() {
  float y = (texture(ty, uv).r - 0.0627451) * 1.1643836;
  float u = texture(tu, uv).r - 0.5;
  float v = texture(tv, uv).r - 0.5;
  vec3 rgb = bt709 == 1
    ? vec3(y + 1.7927 * v, y - 0.2132 * u - 0.5329 * v, y + 2.1124 * u)
    : vec3(y + 1.5958 * v, y - 0.3917 * u - 0.8129 * v, y + 2.0172 * u);
  color = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

export function createVideoSurface() {
  const canvas = document.createElement('canvas');
  canvas.className = 'k-video';
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is required');

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = name => gl.getUniformLocation(prog, name);
  const uRect = u('rect');
  const uCrop = u('crop');
  const uOff = u('off');
  const u709 = u('bt709');
  const textures = ['ty', 'tu', 'tv'].map((name, i) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.uniform1i(u(name), i);
    return t;
  });
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const sampler = Object.assign(document.createElement('canvas'), { width: 6, height: 6 }).getContext('2d', { willReadFrequently: true });
  let pending = null;       // newest frame waiting to be uploaded
  let frameW = 0, frameH = 0;
  let hasFrame = false;
  let dirty = true;
  const view = { aspect: 'auto', zoom: 1, displayAspect: 16 / 9, cropX: 1, cropY: 1, trim: false };
  // Black bars baked into the picture, measured from VLC's luma plane. The smallest bars seen win,
  // so a dark scene never makes the bars look bigger than they are.
  let bars = null;
  let barsAt = 0;
  function measureBars(bytes, w, h) {
    const vw = Math.max(8, Math.floor(w * view.cropX));
    const vh = Math.max(8, Math.floor(h * view.cropY));
    const row = y => { let sum = 0, n = 0; for (let x = 4; x < vw; x += 8) { sum += bytes[y * w + x]; n++; } return sum / n; };
    if (row(vh >> 1) < 26) return;
    let top = 0, bottom = 0;
    while (top < vh * 0.3 && row(top) < 24) top++;
    while (bottom < vh * 0.3 && row(vh - 1 - bottom) < 24) bottom++;
    const t = top / vh < 0.012 ? 0 : top / vh;
    const b = bottom / vh < 0.012 ? 0 : bottom / vh;
    bars = bars ? { top: Math.min(bars.top, t), bottom: Math.min(bars.bottom, b) } : { top: t, bottom: b };
  }

  const ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '21:9': 21 / 9, '1:1': 1, '2.39:1': 2.39, '5:4': 1.25 };

  function upload(ab) {
    const dv = new DataView(ab);
    const w = dv.getUint32(0, true);
    const h = dv.getUint32(4, true);
    const ySize = w * h;
    const cSize = (w >> 1) * (h >> 1);
    const bytes = new Uint8Array(ab, 16);
    const planes = [[bytes.subarray(0, ySize), w, h], [bytes.subarray(ySize, ySize + cSize), w >> 1, h >> 1], [bytes.subarray(ySize + cSize, ySize + 2 * cSize), w >> 1, h >> 1]];
    const resized = w !== frameW || h !== frameH;
    planes.forEach(([data, pw, ph], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
      if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, pw, ph, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pw, ph, gl.RED, gl.UNSIGNED_BYTE, data);
    });
    frameW = w;
    frameH = h;
    hasFrame = true;
    if (++barsAt % 40 === 1) measureBars(bytes, w, h);
  }

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    return [cw, ch];
  }

  function draw() {
    const [cw, ch] = layout();
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!hasFrame) return;
    const trimmed = view.trim && bars ? 1 - bars.top - bars.bottom : 1;
    const target = ASPECTS[view.aspect] || view.displayAspect / trimmed;
    let w, h;
    if (view.aspect === 'fill') { w = 2; h = 2; }
    else {
      const box = cw / ch;
      const cover = view.aspect === 'crop';
      if ((target > box) !== cover) { w = 2; h = 2 * (box / target); }
      else { h = 2; w = 2 * (target / box); }
    }
    w *= view.zoom;
    h *= view.zoom;
    gl.uniform4f(uRect, -w / 2, -h / 2, w, h);
    gl.uniform2f(uCrop, view.cropX, view.cropY * trimmed);
    gl.uniform2f(uOff, 0, view.trim && bars ? bars.top * view.cropY : 0);
    gl.uniform1i(u709, frameH >= 600 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function loop() {
    if (pending) { upload(pending); pending = null; dirty = true; }
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  new ResizeObserver(() => { dirty = true; }).observe(canvas);

  return {
    canvas,
    pushFrame(ab) { pending = ab; },
    clear() { hasFrame = false; pending = null; frameW = frameH = 0; bars = null; barsAt = 0; dirty = true; },
    // Fraction of the picture taken by baked-in black bars, or null until a frame has been measured.
    get bars() { return bars; },
    setTrim(on) { view.trim = !!on; dirty = true; },
    // Aspect of what is actually picture, once bars are cut away.
    contentAspect() { return bars ? view.displayAspect / Math.max(0.3, 1 - bars.top - bars.bottom) : view.displayAspect; },
    get hasFrame() { return hasFrame; },
    setView(patch) { Object.assign(view, patch); dirty = true; },
    // Visible region and display aspect come from VLC's track info (frames may carry decoder padding).
    setGeometry({ width, height, sourceWidth, sourceHeight, sarNum, sarDen }) {
      if (width && height) {
        const sar = sarNum && sarDen ? sarNum / sarDen : 1;
        view.displayAspect = (width * sar) / height;
        view.cropX = sourceWidth ? Math.min(1, width / sourceWidth) : 1;
        view.cropY = sourceHeight ? Math.min(1, height / sourceHeight) : 1;
      }
      dirty = true;
    },
    // Average colour of the current picture, for templates that tint themselves to the scene.
    sampleColor() {
      if (!hasFrame) return null;
      sampler.drawImage(canvas, 0, 0, 6, 6);
      const d = sampler.getImageData(0, 0, 6, 6).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    },
    snapshotDataUrl(type = 'image/jpeg') { return hasFrame ? canvas.toDataURL(type, 0.85) : null; },
  };
}
