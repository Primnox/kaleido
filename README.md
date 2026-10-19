# Kaleido

A video player with VLC's engine and a new kind of interface. The interface is called Prose: there are no buttons, sliders or menus. It is one sentence about what is happening, and every control is a word in it.

> The Long Way North, 41 minutes in. Pause. It's loud, in English, without words, at normal speed. More.

- Click a lit word to change it, drag it to slide it, scroll on it to roll through its choices.
- Pause and the lights come up. Find a moment by what it looked like, not by a timestamp.
- Right-click (or "More") for everything VLC hides in its menus, written as sentences you edit.
- Open the app and the last thing you watched is waiting where you left it.

## How it works

- `engine/` is a small Rust program that loads libVLC from `vendor/vlc`, receives decoded frames through VLC's video callbacks and streams them, along with the player state, over a local WebSocket. Playback, codecs, subtitles, the equalizer and filters are all VLC.
- `main.js` is the Electron main process. It starts the engine, restarts it if a VLC module crashes, and handles files, windows and saved state.
- `src/core/` draws frames with WebGL and keeps the player state (`engine.js`), and holds the shared shell (keyboard, drag and drop, idle hiding).
- `src/skins/prose/` is the Prose interface.

ffmpeg is optional and only used for frame previews, the colour line at the end, and posters.

## Run it

```
npm install
npm run setup
npm start
```

`npm run setup` downloads VLC 3.0.24 from videolan.org (checksum verified) into `vendor/vlc` and builds the Rust engine. It needs the Rust toolchain with the MSVC target.
