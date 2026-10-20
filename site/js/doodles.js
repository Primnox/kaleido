// Moving line doodles for the home page. Each one appears once, draws itself in, then keeps moving.
// Coordinates live in a 1200 x 520 box; the hero anchors it to the right so the words keep the left.

const STRIP = 'M-900 60 C -700 10, -260 136, -40 78 C 180 20, 400 150, 640 80 S 1010 20, 1240 92';

export const DOODLES = `
<svg class="dd" viewBox="0 0 1200 520" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">
  <defs>
    <clipPath id="ddScreen"><rect x="1034" y="169" width="142" height="82" rx="2"/></clipPath>
    <linearGradient id="ddBeam" x1="896" y1="330" x2="1034" y2="210" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe2ad" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#ffe2ad" stop-opacity="0.05"/>
    </linearGradient>
  </defs>

  <g class="dd-g dd-strip" style="--d:0s">
    <path class="dd-ln" pathLength="1" d="${STRIP}" style="stroke-width:46px"/>
    <path d="${STRIP}" style="stroke-width:42px" class="dd-bg"/>
    <path class="dd-perf" d="${STRIP}" style="stroke-width:36px" stroke-dasharray="5 9"/>
    <path d="${STRIP}" style="stroke-width:28px" class="dd-bg"/>
    <path class="dd-frames" d="${STRIP}" style="stroke-width:20px" stroke-dasharray="38 8"/>
  </g>

  <g class="dd-g dd-beamg" style="--d:1.4s">
    <polygon class="dd-beam" points="896,320 896,342 1034,252 1034,168" fill="url(#ddBeam)"/>
    <g class="dd-dust">
      <circle cx="918" cy="318" r="1.8" style="--t:0s"/>
      <circle cx="930" cy="300" r="1.3" style="--t:1.1s"/>
      <circle cx="944" cy="326" r="1.6" style="--t:2.3s"/>
      <circle cx="960" cy="296" r="1.2" style="--t:0.6s"/>
      <circle cx="975" cy="314" r="1.7" style="--t:1.7s"/>
      <circle cx="990" cy="282" r="1.1" style="--t:2.9s"/>
    </g>
  </g>

  <g class="dd-g dd-screen" style="--d:1.1s">
    <rect class="dd-ln" pathLength="1" x="1030" y="165" width="150" height="90" rx="3"/>
    <image class="dd-poster" clip-path="url(#ddScreen)" x="1034" y="169" width="142" height="82" preserveAspectRatio="xMidYMid slice"/>
    <path class="dd-ln" pathLength="1" d="M1105 255 V298 M1078 298 H1132"/>
  </g>

  <g class="dd-g dd-projector" style="--d:0.5s">
    <path class="dd-ln" pathLength="1" d="M742 300 h126 a8 8 0 0 1 8 8 v54 a8 8 0 0 1 -8 8 h-126 a8 8 0 0 1 -8 -8 v-54 a8 8 0 0 1 8 -8 z"/>
    <path class="dd-ln" pathLength="1" d="M876 318 h20 v26 h-20"/>
    <path class="dd-ln" pathLength="1" d="M760 370 L748 424 M852 370 L864 424 M806 370 L806 424"/>
    <path class="dd-ln" pathLength="1" d="M756 324 h40 M756 338 h28"/>
    <g class="dd-reel">
      <circle class="dd-ln" pathLength="1" cx="772" cy="264" r="30"/>
      <circle cx="772" cy="264" r="5"/>
      <path d="M772 238 V290 M749.5 251 L794.5 277 M749.5 277 L794.5 251"/>
    </g>
    <g class="dd-reel dd-reel2">
      <circle class="dd-ln" pathLength="1" cx="842" cy="272" r="22"/>
      <circle cx="842" cy="272" r="4"/>
      <path d="M842 252 V292 M824.7 262 L859.3 282 M824.7 282 L859.3 262"/>
    </g>
    <path class="dd-ln" pathLength="1" d="M772 294 L776 300 M842 294 L838 300"/>
  </g>

  <g class="dd-g dd-clap" style="--d:0.8s">
    <rect class="dd-ln" pathLength="1" x="560" y="372" width="92" height="62" rx="4"/>
    <path class="dd-ln" pathLength="1" d="M572 392 H640 M572 406 H620 M572 420 H632"/>
    <g class="dd-arm">
      <rect x="560" y="356" width="92" height="14" rx="2" class="dd-fillbg"/>
      <path d="M578 356 l-8 14 M598 356 l-8 14 M618 356 l-8 14 M638 356 l-8 14"/>
    </g>
  </g>

  <g class="dd-g dd-pop" style="--d:1.0s">
    <path class="dd-ln" pathLength="1" d="M956 410 L1016 410 L1008 472 L964 472 Z"/>
    <path class="dd-red" d="M972 412 L975 470 M986 412 L986 470 M1000 412 L997 470"/>
    <path class="dd-ln" pathLength="1" d="M958 410 q5 -14 14 -6 q6 -14 16 -4 q8 -12 16 0 q8 -6 10 10"/>
    <g class="dd-kernel" style="--kx:-14px; --t:0s"><path d="M978 396 a5 5 0 1 1 6 -6 a5 5 0 1 1 6 6 a5 5 0 1 1 -12 0 z"/></g>
    <g class="dd-kernel" style="--kx:10px; --t:0.9s"><path d="M992 398 a4 4 0 1 1 5 -5 a4 4 0 1 1 5 5 a4 4 0 1 1 -10 0 z"/></g>
    <g class="dd-kernel" style="--kx:-4px; --t:1.7s"><path d="M984 400 a4.5 4.5 0 1 1 5.5 -5.5 a4.5 4.5 0 1 1 5.5 5.5 a4.5 4.5 0 1 1 -11 0 z"/></g>
  </g>

  <g class="dd-g dd-leader" style="--d:1.3s">
    <circle class="dd-ln" pathLength="1" cx="1100" cy="404" r="48"/>
    <circle cx="1100" cy="404" r="38" class="dd-faint"/>
    <path d="M1100 352 V456 M1048 404 H1152" class="dd-faint"/>
    <path class="dd-sweep" d="M1100 404 L1100 356 A48 48 0 0 1 1141.6 380 Z"/>
    <text class="dd-num dd-n3" x="1100" y="419">3</text>
    <text class="dd-num dd-n2" x="1100" y="419">2</text>
    <text class="dd-num dd-n1" x="1100" y="419">1</text>
  </g>

  <g class="dd-g dd-chai" style="--d:0.9s">
    <path class="dd-ln" pathLength="1" d="M664 446 h46 l-5 40 a6 6 0 0 1 -6 5 h-24 a6 6 0 0 1 -6 -5 z"/>
    <path class="dd-ln" pathLength="1" d="M709 454 q14 0 12 12 q-2 10 -14 10"/>
    <path class="dd-ln" pathLength="1" d="M650 497 h74"/>
    <path class="dd-steam" style="--t:0s" d="M676 438 q-6 -8 0 -16 q6 -8 0 -16"/>
    <path class="dd-steam" style="--t:0.8s" d="M688 436 q-6 -8 0 -16 q6 -8 0 -16"/>
    <path class="dd-steam" style="--t:1.6s" d="M700 438 q-6 -8 0 -16 q6 -8 0 -16"/>
  </g>

  <g class="dd-g dd-phones" style="--d:0.6s">
    <path class="dd-ln" pathLength="1" d="M532 248 v-10 a28 28 0 0 1 56 0 v10"/>
    <rect class="dd-ln" pathLength="1" x="524" y="242" width="14" height="26" rx="5"/>
    <rect class="dd-ln" pathLength="1" x="582" y="242" width="14" height="26" rx="5"/>
    <path class="dd-wave" style="--t:0s" d="M604 246 q8 9 0 18"/>
    <path class="dd-wave" style="--t:0.35s" d="M613 240 q13 15 0 30"/>
  </g>

  <g class="dd-g dd-ticket" style="--d:0.7s">
    <path class="dd-ln" pathLength="1" d="M664 186 h74 v10 a6 6 0 0 0 0 12 v10 h-74 v-10 a6 6 0 0 0 0 -12 z"/>
    <path d="M718 188 V216" stroke-dasharray="3 4" class="dd-faint"/>
    <text class="dd-small" x="690" y="206">ADMIT ONE</text>
  </g>

  <g class="dd-g dd-glasses" style="--d:1.2s">
    <rect class="dd-ln dd-lred" pathLength="1" x="840" y="130" width="34" height="22" rx="5"/>
    <rect class="dd-ln dd-lcyan" pathLength="1" x="884" y="130" width="34" height="22" rx="5"/>
    <path class="dd-ln" pathLength="1" d="M874 138 q5 -6 10 0 M840 136 l-16 -5 M918 136 l16 -5"/>
  </g>
</svg>`;
