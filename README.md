<img src="assets/logo.svg" width="96" alt="Kaleido logo">

# Kaleido

A video player with VLC's engine and a plain, quiet interface. It plays everything VLC plays.

- Ordinary controls that hide while you watch: seek with frame previews and chapter marks, volume up to 200%, subtitles, audio tracks, speed, full screen.
- Pausing is the one special moment: the room warms up, the picture is held like a photograph (letterbox bars cropped away), and the last few moments you saw sit beside it. Click one to go back there.
- Release-style file names become real titles ("The Long Way North (2024)", not the whole download name).
- Every file remembers where you stopped, and the rest of the folder queues up after it.
- Skip intro during chapters named Intro, Opening or Recap, and an up next card with a countdown near the end.
- Bookmarks (Ctrl+D) shown on the seek bar, double click the left or right side to jump 10 seconds, a queue panel, and a mini player (Ctrl+M).
- Quality badges next to the title (4K, HEVC, 5.1) and six colour themes on the home page, which has moving film doodles.
- **Stream (Ctrl+Shift+S)**, a hub inside the app, on desktop and Android: films, series and anime from TMDB (bring your own free API key), free live TV channels from iptv-org and radio from radio-browser.info. Trailers play silently behind titles, the colours follow whatever is on screen, and films play in Kaleido's own player: Kaleido finds the stream behind an embed source and hands it to VLC, so there are no ads, and you get your subtitles, settings and resume. When no source's stream can be found, the film opens in a theater that health-checks the sources on your network, falls through to the next if one fails, and glows with the picture. Live TV and radio play in Kaleido itself.

## Only in Kaleido

Things the big desktop players (VLC, mpv, PotPlayer, IINA, MPC) do not do:

- **What did they say? (W)** jumps back 10 seconds with subtitles on, then turns them off again.
- **Search what they say (/)** finds any line of dialogue in the subtitles and jumps to it.
- **Languages remembered per series.** Choose the audio and subtitle language once and every file in that folder follows.
- **Skip silence** jumps over long quiet stretches in lectures and recordings.
- **Save a clip (C)** keeps the A to B loop, or the last 30 seconds, as a frame accurate mp4 in Videos, Kaleido clips.
- **Pauses when you lock the PC** or it goes to sleep, and tells you when you are back.

Two other interfaces are still in the project as alternatives (Ctrl+Tab): The room and Prose.

The logo is a lens iris that is also a kaleidoscope: six blades, one for each colour theme, opening onto a play mark. `assets/logo.svg` is the source; `npm run icons` rebuilds `assets/icon.ico` and the PNGs from it.

## How it works

- `engine/` is a small Rust program that loads libVLC from `vendor/vlc`, receives decoded frames through VLC's video callbacks and streams them, along with the player state, over a local WebSocket. Playback, codecs, subtitles, the equalizer and filters are all VLC.
- `main.js` is the Electron main process. It starts the engine, restarts it if a VLC module crashes, and handles files, windows and saved state.
- `src/core/` draws frames with WebGL and keeps the player state (`engine.js`), and holds the shared shell (keyboard, drag and drop, idle hiding).
- `streaming/` holds the hub's main-process side: TMDB, iptv-org and radio-browser clients, embed source health checks, and the locked-down session the theater's `<webview>` guests run in (no Node, https only, no pop-ups, ad networks and ad-tag URL shapes from `adblock.json` blocked). `sniff.js` loads a source in a hidden window under the same rules and catches the HLS playlist or DASH manifest it asks for; `relay.js` is a 127.0.0.1 relay that fetches HLS for VLC with the player's own headers and strips segments' fake image headers. `src/core/browse.js` is the hub's interface. On Android the same data modules run in the page, with the app making their web requests, and the theater and the stream finder use native WebViews under the same rules (`android/.../Theater.kt`, with `Relay.kt` as the relay).
- `src/skins/normal/` is the default interface; `src/skins/room/` and `src/skins/prose/` are the alternatives.
- `android/` is the Android app: the same `src/` in a WebView over libVLC for Android, which draws the picture natively under the page. A small Kotlin bridge speaks the engine's protocol, so `engine.js` runs unchanged; `src/core/native-video.js` and `src/core/touch.js` are the Android pieces.

ffmpeg is optional and only used for frame previews, the colour line at the end, and posters.

## Download

From the [releases page](https://github.com/Primnox/kaleido/releases/latest) or [primnox.github.io/kaleido](https://primnox.github.io/kaleido/):

- **Windows 10 and 11:** `Kaleido-Setup-<version>.exe` or the portable `.exe`. Not code signed yet, so SmartScreen may ask you to choose More info, then Run anyway.
- **macOS 11 or newer:** `Kaleido-<version>-mac-arm64.dmg` for Apple Silicon, `-mac-x64.dmg` for Intel. Not signed by Apple yet, so the first time right click Kaleido in Applications and choose Open.
- **Linux:** `.deb` (pulls in VLC) or `.AppImage` (needs VLC installed: `sudo apt install vlc`).
- **Android 8.0 or newer:** `Kaleido-<version>-android-arm64-v8a.apk` for nearly every phone, `-armeabi-v7a.apk` for older 32-bit ones. Not on the Play Store yet, so allow installing from your browser when Android asks. Tap for the controls, double tap a side to jump 10 seconds, swipe to seek or change the volume and brightness, and press Home while a film plays to keep it going in a small window. Dialogue search, skip silence and clips need FFmpeg and are desktop only for now.

Windows and Mac downloads carry VLC and FFmpeg inside; the Android APK carries VLC.

## Build the installers

```
npm run dist
```

`scripts/stage.js` gathers the engine, VLC and FFmpeg for the current system into `staging/`, then electron-builder writes the installers to `dist/`. The [Build installers](.github/workflows/build.yml) workflow does this on Windows, macOS (Apple Silicon and Intel) and Linux runners, and publishes a release when a `v*` tag is pushed. The same workflow builds the Android APKs (signed with the release key in the repository's secrets). The website lives in `site/`; `node scripts/build-site.js` refreshes the logo and doodles it shares with the app.

## Run it from source

```
npm install
npm run setup
npm start
```

`npm run setup` downloads VLC 3.0.24 from videolan.org (checksum verified) into `vendor/vlc` and builds the Rust engine. It needs the Rust toolchain with the MSVC target.

For Android, open `android/` in Android Studio, or with the Android SDK and Java 21 installed:

```
cd android
./gradlew assembleDebug
```

The build copies `src/`, the logo and the hub's data modules from `streaming/` into the app, so desktop and Android always share one interface.
