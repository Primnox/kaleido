# Kaleido Video Player UX Research

## Player Evaluations

### VLC Media Player
Loves:
* Plays virtually every format and container out of the box without extra codecs.
* Volume boost feature that amplifies sound up to 200 percent for quiet dialogue.
* Dedicated keyboard shortcuts to sync audio delay and subtitle timing on the fly.
Hates:
* Dated Qt interface that feels clunky and inconsistent with modern operating systems.
* Washed out colors and poor HDR tone mapping on standard displays.
* Noticeable stutter and slow seeking when scrubbing high bitrate 4K video files.
Source: Reddit r software: "Best video player for Windows in 2024"

### mpv
Loves:
* Completely distraction-free borderless window with no interface clutter.
* Industry-leading rendering quality with custom shaders and color management.
* Extreme responsiveness and instant startup speed.
Hates:
* Absence of a graphical settings menu, forcing users to edit text config files.
* High barrier to entry for non-technical users.
* Barebones default on-screen controller with limited mouse controls.
Source: Hacker News: "Ask HN: What is your favorite media player?"

### MPC-HC and MPC-BE
Loves:
* Instantaneous seeking with hover thumbnail previews along the timeline.
* Lightweight resource footprint and near-instant application startup.
* Smooth integration with madVR for high quality video upscaling.
Hates:
* Windows only, offering no support for macOS or Linux.
* Retro Win32 interface aesthetics that look like legacy software.
* Complex filter management when external decoders conflict.
Source: Reddit r DataHoarder: "Media player with best subtitle and tone mapping support"

### PotPlayer
Loves:
* Massive variety of customizable skins and interface layouts.
* Advanced subtitle capabilities including dual subtitles and real-time translation.
* Built-in capture tools and smooth hardware accelerated decoding.
Hates:
* History of bundled adware, installer promos, and intrusive popups.
* Unwanted background telemetry and network connections.
* Overwhelming settings menu packed with hundreds of cluttered options.
Source: Reddit r pcmasterrace: "Why does everyone hate PotPlayer now?"

### IINA
Loves:
* Clean design that matches native macOS design principles.
* Deep trackpad integration including pinch to zoom and smooth seeking gestures.
* Native Picture in Picture support and automatic dark mode switching.
Hates:
* Higher battery drain and CPU temperature compared to native Apple players.
* Occasional audio synchronization drift when scrubbing rapidly.
* Memory leaks during long continuous playback sessions.
Source: Reddit r macapps: "IINA vs Infuse vs VLC for macOS"

### Infuse
Loves:
* Gorgeous automated poster artwork and metadata scraping.
* Flawless direct streaming from cloud services, network shares, and media servers.
* Smooth handling of Dolby Vision and spatial audio.
Hates:
* Ongoing subscription fee or high lifetime license cost.
* Exclusivity to the Apple ecosystem.
* Lack of deep video calibration and rendering tweaks for enthusiasts.
Source: Reddit r appletv: "Is Infuse Pro worth the subscription?"

### MX Player
Loves:
* Intuitive vertical edge swipe gestures for brightness and volume.
* Full-screen horizontal swipe gestures for precise scrubbing.
* Audio boost mode that pushes volume well past hardware defaults.
Hates:
* Heavy commercialization with full-screen banner and video ads.
* Cluttered home screen pushed full of online streaming feeds and games.
* Significant bloatware added after corporate acquisition.
Source: Reddit r androidapps: "Alternatives to MX Player without ads"

### KMPlayer
Loves:
* Broad support for legacy, obscure, and modern media containers.
* Comprehensive color adjustment, equalizer, and video filter toolbars.
* Direct URL streaming and playback capabilities.
Hates:
* Bundled installer offers attempting to install third party programs.
* Noticeably slow launch times and high CPU usage.
* Intrusive promotional banners inside the playback window.
Source: Reddit r software: "KMPlayer was once the king, what happened?"

### GOM Player
Loves:
* Automatic codec search assistant that locates missing decoders for broken files.
* Built-in support for 360-degree VR video navigation.
* Simple A to B segment looping for practice, transcription, and study.
Hates:
* Persistent exit popups advertising other software.
* Installer setup loaded with pre-checked third party software offers.
* Stuttering playback and sluggish controls on high resolution files.
Source: Reddit r techsupport: "GOM Player ads and bloatware issues"

### Windows Media Player and Films & TV
Loves:
* Seamless operating system integration with minimal battery consumption.
* Instant launch speed for quick file inspection.
* Neat mini-player view that floats above active windows.
Hates:
* Requires paid extensions from Microsoft Store for basic formats like HEVC.
* Very poor subtitle handling with limited formatting and bad external file recognition.
* Frequent playback failures on MKV and non-standard audio streams.
Source: Reddit r windows: "Why Windows Movies and TV cannot play basic formats"

### QuickTime Player
Loves:
* Studio-grade color fidelity for ProRes and camera footage.
* Unmatched battery efficiency on Apple silicon hardware.
* Instant, integrated screen and audio recording tools.
Hates:
* Total refusal to play MKV, FLAC, and common web media containers.
* Zero subtitle styling or customization options.
* Clunky scrubbing interface with no customizable shortcut jump intervals.
Source: Reddit r mac: "Why QuickTime still refuses to support MKV"

### Plex and Kodi
Loves:
* 10-foot couch interface built for television screens and remote controls.
* Centralized watch state tracking with automatic resume across devices.
* Boundless skin customization and community add-on support in Kodi.
Hates:
* Terrible mouse and desktop navigation ergonomics in Kodi.
* Aggressive promotion of ad-supported streaming content and forced logins in Plex.
* Transcoding pauses and buffering triggered by complex subtitle formats.
Source: Reddit r homeassistant: "Plex vs Kodi for local offline media libraries"

### YouTube and Netflix Web Players
Loves:
* Universal keyboard shortcuts including J, K, and L alongside 5-second arrow jumps.
* Instant visual hover preview thumbnails across the entire progress bar.
* Quality of life features like skip intro, skip credits, and variable speed toggles.
Hates:
* End-screen recommendation cards that obstruct credits and final scenes.
* Video resolution caps on desktop browsers due to strict DRM rules.
* Heavy browser overlays that cover playback and drain system resources.
Source: Hacker News: "The subtle ergonomics of video player scrubbing"

## Cross-Player Patterns

### Top 15 Loves
1. Out of the box playback for all media formats without installing external codecs.
2. Instant startup time with zero loading delay.
3. Accurate timeline scrubbing paired with hover preview thumbnails.
4. Minimalist interface that fades out completely during playback.
5. Audio volume boost past 100 percent for quiet media.
6. Single-key shortcuts to adjust audio sync and subtitle timing instantly.
7. Smooth trackpad and mouse wheel gestures for volume, brightness, and seeking.
8. Hardware accelerated decoding that keeps laptops cool and quiet.
9. Resuming playback exactly where the user left off.
10. Native operating system styling with proper dark mode integration.
11. Reliable HDR tone mapping on standard dynamic range monitors.
12. Picture in Picture floating window mode.
13. Automatic subtitle fetching and styled subtitle rendering.
14. Smart playback features such as skip intro and jump forward intervals.
15. Extensive customizability for keyboard shortcuts and interface themes.

### Top 15 Hates
1. Bundled adware, promotional popups, and installer bloatware.
2. Telemetry, background network tracking, and forced cloud accounts.
3. Playback stutter, frame drops, and slow seeking on 4K content.
4. Missing codec errors and paid codec downloads for standard formats.
5. Outdated, cluttered user interfaces with tiny buttons and deep menus.
6. Absence of hover thumbnail previews when seeking along the timeline.
7. Forced online stores, streaming tabs, and irrelevant content feeds.
8. Rapid battery drain and loud system fans on portable devices.
9. Rigid, unchangeable keyboard shortcuts and hidden control schemes.
10. Washed out, grey colors caused by broken HDR tone mapping.
11. Subtitle rendering failures, font glitches, and timing drift.
12. Requiring text configuration file edits for basic settings changes.
13. On-screen controls or recommendation overlays that refuse to hide.
14. Expensive recurring subscriptions for basic local media playback.
15. Inability to open common container formats like MKV.

## Personas

### 1. Binge Watcher
* Wants: Automatic next episode loading, skip intro buttons, reliable playback resume memory, and quick subtitle language switching.
* Hates: Having to use the mouse between episodes, audio volume spikes between dialogue and action, and broken subtitle formatting.

### 2. Keyboard Purist
* Wants: Full keyboard control for all operations, J, K, and L scrubbing, 5-second and single-frame stepping, and zero visible controls during playback.
* Hates: Mandatory mouse interactions, floating bars that do not auto-hide immediately, and sluggish hotkey response times.

### 3. Power User Videophile
* Wants: Advanced video renderers, custom shader support, precise HDR to SDR tone mapping, and detailed on-screen playback statistics.
* Hates: Low quality hardware scaling, locked down video pipelines, washed out colors, and forced audio resampling.

### 4. Nostalgic Tinkerer
* Wants: Highly themeable skins reminiscent of classic players, detailed audio equalizers, customizable toolbars, and rich playlist docks.
* Hates: Overly simplified flat interfaces with stripped features, hidden technical details, and forced cloud integration.

### 5. Laptop and Touch User
* Wants: Excellent battery efficiency, trackpad pinch to zoom, edge swipe gestures for volume and brightness, and smooth Picture in Picture.
* Hates: Loud laptop fan noise, rapid battery drain, and tiny interface click targets designed solely for mouse pointers.

### 6. Music and Audio Listener
* Wants: Ultra-compact mini-player mode, gapless audio playback, global background hotkeys, and support for high resolution audio formats.
* Hates: Bulky video player windows that cannot minimize to a compact bar, missing album art, and lack of audio channel downmixing.
