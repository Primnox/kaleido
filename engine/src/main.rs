//! Kaleido engine: hosts libVLC, streams decoded I420 frames and player state to the UI
//! over a local WebSocket. Everything about playback (demuxing, decoding, subtitles,
//! equalizer, filters, A/V sync) is VLC itself; the UI only draws frames and sends commands.

use std::ffi::{CStr, CString};
use std::io::{ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::os::raw::{c_char, c_int, c_uint, c_void};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use libloading::Library;
use serde_json::{json, Value};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::{Error as WsError, Message};

type P = *mut c_void;
type EventCb = unsafe extern "C" fn(*const Event, P);
type LockCb = unsafe extern "C" fn(P, *mut P) -> P;
type UnlockCb = unsafe extern "C" fn(P, P, *const P);
type DisplayCb = unsafe extern "C" fn(P, P);
type FormatCb = unsafe extern "C" fn(*mut P, *mut c_char, *mut c_uint, *mut c_uint, *mut c_uint, *mut c_uint) -> c_uint;
type CleanupCb = unsafe extern "C" fn(P);

#[repr(C)]
struct TrackDesc { id: c_int, name: *mut c_char, next: *mut TrackDesc }
#[repr(C)]
struct ChapterDesc { offset: i64, duration: i64, name: *mut c_char }
#[repr(C)]
struct VideoTrack { height: c_uint, width: c_uint, sar_num: c_uint, sar_den: c_uint, fr_num: c_uint, fr_den: c_uint }
#[repr(C)]
struct AudioTrack { channels: c_uint, rate: c_uint }
#[repr(C)]
struct MediaTrack {
    codec: u32, fourcc: u32, id: c_int, kind: c_int, profile: c_int, level: c_int,
    detail: P, bitrate: c_uint, language: *mut c_char, description: *mut c_char,
}
#[repr(C)]
struct Event { kind: c_int, obj: P, data: [u64; 2] }

macro_rules! vlc_api {
    ($($name:ident : fn($($arg:ty),*) $(-> $ret:ty)?;)*) => {
        #[allow(non_snake_case)]
        struct Api { $($name: unsafe extern "C" fn($($arg),*) $(-> $ret)?,)* }
        impl Api {
            unsafe fn load(lib: &Library) -> Result<Api, String> {
                Ok(Api { $($name: *lib
                    .get(concat!(stringify!($name), "\0").as_bytes())
                    .map_err(|e| format!("{}: {}", stringify!($name), e))?,)* })
            }
        }
    };
}

vlc_api! {
    libvlc_new: fn(c_int, *const *const c_char) -> P;
    libvlc_get_version: fn() -> *const c_char;
    libvlc_errmsg: fn() -> *const c_char;
    libvlc_free: fn(P);
    libvlc_media_new_path: fn(P, *const c_char) -> P;
    libvlc_media_new_location: fn(P, *const c_char) -> P;
    libvlc_media_add_option: fn(P, *const c_char);
    libvlc_media_release: fn(P);
    libvlc_media_get_meta: fn(P, c_int) -> *mut c_char;
    libvlc_media_tracks_get: fn(P, *mut *mut *mut MediaTrack) -> c_uint;
    libvlc_media_tracks_release: fn(*mut *mut MediaTrack, c_uint);
    libvlc_media_player_new: fn(P) -> P;
    libvlc_media_player_set_media: fn(P, P);
    libvlc_media_player_get_media: fn(P) -> P;
    libvlc_media_player_play: fn(P) -> c_int;
    libvlc_media_player_set_pause: fn(P, c_int);
    libvlc_media_player_stop: fn(P);
    libvlc_media_player_is_playing: fn(P) -> c_int;
    libvlc_media_player_get_length: fn(P) -> i64;
    libvlc_media_player_get_time: fn(P) -> i64;
    libvlc_media_player_set_time: fn(P, i64);
    libvlc_media_player_set_rate: fn(P, f32) -> c_int;
    libvlc_media_player_next_frame: fn(P);
    libvlc_media_player_event_manager: fn(P) -> P;
    libvlc_event_attach: fn(P, c_int, EventCb, P) -> c_int;
    libvlc_media_player_get_full_chapter_descriptions: fn(P, c_int, *mut *mut *mut ChapterDesc) -> c_int;
    libvlc_chapter_descriptions_release: fn(*mut *mut ChapterDesc, c_uint);
    libvlc_media_player_get_chapter: fn(P) -> c_int;
    libvlc_media_player_set_chapter: fn(P, c_int);
    libvlc_media_player_add_slave: fn(P, c_int, *const c_char, bool) -> c_int;
    libvlc_audio_set_volume: fn(P, c_int) -> c_int;
    libvlc_audio_set_mute: fn(P, c_int);
    libvlc_audio_get_track_description: fn(P) -> *mut TrackDesc;
    libvlc_audio_get_track: fn(P) -> c_int;
    libvlc_audio_set_track: fn(P, c_int) -> c_int;
    libvlc_audio_set_delay: fn(P, i64) -> c_int;
    libvlc_video_get_spu_description: fn(P) -> *mut TrackDesc;
    libvlc_video_get_spu: fn(P) -> c_int;
    libvlc_video_set_spu: fn(P, c_int) -> c_int;
    libvlc_video_set_spu_delay: fn(P, i64) -> c_int;
    libvlc_track_description_list_release: fn(*mut TrackDesc);
    libvlc_video_set_callbacks: fn(P, LockCb, UnlockCb, DisplayCb, P);
    libvlc_video_set_format_callbacks: fn(P, FormatCb, CleanupCb);
    libvlc_video_set_adjust_int: fn(P, c_uint, c_int);
    libvlc_video_set_adjust_float: fn(P, c_uint, f32);
    libvlc_video_set_deinterlace: fn(P, *const c_char);
    libvlc_video_take_snapshot: fn(P, c_uint, *const c_char, c_uint, c_uint) -> c_int;
    libvlc_audio_equalizer_get_preset_count: fn() -> c_uint;
    libvlc_audio_equalizer_get_preset_name: fn(c_uint) -> *const c_char;
    libvlc_audio_equalizer_get_band_count: fn() -> c_uint;
    libvlc_audio_equalizer_get_band_frequency: fn(c_uint) -> f32;
    libvlc_audio_equalizer_new: fn() -> P;
    libvlc_audio_equalizer_new_from_preset: fn(c_uint) -> P;
    libvlc_audio_equalizer_release: fn(P);
    libvlc_audio_equalizer_get_preamp: fn(P) -> f32;
    libvlc_audio_equalizer_set_preamp: fn(P, f32) -> c_int;
    libvlc_audio_equalizer_get_amp_at_index: fn(P, c_uint) -> f32;
    libvlc_audio_equalizer_set_amp_at_index: fn(P, f32, c_uint) -> c_int;
    libvlc_media_player_set_equalizer: fn(P, P) -> c_int;
}

const HEADER: usize = 16;

struct Frames {
    max_w: u32, max_h: u32, w: u32, h: u32,
    bufs: Vec<Vec<u8>>, free: Vec<usize>,
}

struct Shared {
    api: Api,
    mp: usize,
    frames: Mutex<Frames>,
    event_tx: Mutex<Option<Sender<String>>>,
    frame_tx: Mutex<Option<SyncSender<Vec<u8>>>>,
    tracks_dirty: AtomicBool,
    loaded: AtomicBool,
    last_buffering: AtomicU32,
}

static SHARED: OnceLock<Shared> = OnceLock::new();
fn sh() -> &'static Shared { SHARED.get().expect("engine not initialised") }
fn mp() -> P { sh().mp as P }
fn api() -> &'static Api { &sh().api }

fn emit(v: Value) {
    if let Some(tx) = sh().event_tx.lock().unwrap().as_ref() {
        let _ = tx.send(v.to_string());
    }
}

unsafe fn cstr(p: *const c_char) -> String {
    if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

fn fourcc(v: u32) -> String {
    v.to_le_bytes().iter().map(|&b| b as char).collect::<String>().trim().to_string()
}

// ---------- libVLC callbacks (run on VLC threads, so they only touch channels and buffers) ----------

unsafe extern "C" fn on_event(ev: *const Event, _: P) {
    let e = &*ev;
    let d = e.data[0];
    let state = |s: &str| emit(json!({ "ev": "state", "state": s }));
    match e.kind {
        0x102 => state("opening"),
        0x103 => {
            // Only report the edges (started buffering, done buffering) so the UI is not flooded.
            let pct = f32::from_bits(d as u32).round() as u32;
            let last = sh().last_buffering.swap(pct, Ordering::Relaxed);
            if last == u32::MAX || (pct >= 100) != (last >= 100) {
                emit(json!({ "ev": "buffering", "value": pct }));
            }
        }
        0x104 => { state("playing"); sh().tracks_dirty.store(true, Ordering::Relaxed); }
        0x105 => state("paused"),
        0x106 => state("stopped"),
        0x109 => state("ended"),
        0x10A => emit(json!({ "ev": "state", "state": "error", "message": cstr((api().libvlc_errmsg)()) })),
        0x110 => emit(json!({ "ev": "snapshot", "path": cstr(d as *const c_char) })),
        0x111 => emit(json!({ "ev": "length", "length": d as i64 })),
        0x112 | 0x114 | 0x115 | 0x116 | 0x11D => sh().tracks_dirty.store(true, Ordering::Relaxed),
        _ => {}
    }
}

unsafe extern "C" fn video_format(
    _opaque: *mut P, chroma: *mut c_char, width: *mut c_uint, height: *mut c_uint,
    pitches: *mut c_uint, lines: *mut c_uint,
) -> c_uint {
    let (sw, sh_) = (*width, *height);
    let mut f = sh().frames.lock().unwrap();
    let scale = (f.max_w as f64 / sw as f64).min(f.max_h as f64 / sh_ as f64).min(1.0);
    let w = (((sw as f64 * scale) as u32) & !15).max(16);
    let h = (((sh_ as f64 * scale) as u32) & !1).max(2);
    std::ptr::copy_nonoverlapping(b"I420".as_ptr() as *const c_char, chroma, 4);
    *width = w;
    *height = h;
    let p = std::slice::from_raw_parts_mut(pitches, 3);
    let l = std::slice::from_raw_parts_mut(lines, 3);
    p[0] = w; p[1] = w / 2; p[2] = w / 2;
    l[0] = h; l[1] = h / 2; l[2] = h / 2;
    f.w = w;
    f.h = h;
    f.bufs.clear();
    f.free.clear();
    emit(json!({ "ev": "format", "width": w, "height": h, "sourceWidth": sw, "sourceHeight": sh_ }));
    3
}

unsafe extern "C" fn video_cleanup(_: P) {
    emit(json!({ "ev": "format", "width": 0, "height": 0 }));
}

unsafe extern "C" fn video_lock(_: P, planes: *mut P) -> P {
    let mut f = sh().frames.lock().unwrap();
    let (w, h) = (f.w as usize, f.h as usize);
    let idx = match f.free.pop() {
        Some(i) => i,
        None => {
            let mut buf = vec![0u8; HEADER + w * h * 3 / 2];
            buf[0..4].copy_from_slice(&(w as u32).to_le_bytes());
            buf[4..8].copy_from_slice(&(h as u32).to_le_bytes());
            f.bufs.push(buf);
            f.bufs.len() - 1
        }
    };
    let base = f.bufs[idx].as_mut_ptr().add(HEADER);
    let planes = std::slice::from_raw_parts_mut(planes, 3);
    planes[0] = base as P;
    planes[1] = base.add(w * h) as P;
    planes[2] = base.add(w * h + (w / 2) * (h / 2)) as P;
    (idx + 1) as P
}

unsafe extern "C" fn video_unlock(_: P, id: P, _: *const P) {
    let mut f = sh().frames.lock().unwrap();
    let idx = id as usize - 1;
    if idx < f.bufs.len() { f.free.push(idx); }
}

unsafe extern "C" fn video_display(_: P, id: P) {
    let f = sh().frames.lock().unwrap();
    if let Some(buf) = f.bufs.get(id as usize - 1) {
        if let Some(tx) = sh().frame_tx.lock().unwrap().as_ref() {
            // Drop frames rather than queue them if the UI falls behind; VLC keeps A/V sync.
            let _ = tx.try_send(buf.clone());
        }
    }
}

// ---------- state snapshots ----------

unsafe fn track_list(head: *mut TrackDesc) -> Vec<Value> {
    let mut out = vec![];
    let mut cur = head;
    while !cur.is_null() {
        out.push(json!({ "id": (*cur).id, "name": cstr((*cur).name) }));
        cur = (*cur).next;
    }
    if !head.is_null() { (api().libvlc_track_description_list_release)(head); }
    out
}

unsafe fn tracks_info() -> Value {
    let a = api();
    let m = mp();
    let audio = track_list((a.libvlc_audio_get_track_description)(m));
    let spu = track_list((a.libvlc_video_get_spu_description)(m));

    let mut chapters = vec![];
    let mut arr: *mut *mut ChapterDesc = std::ptr::null_mut();
    let n = (a.libvlc_media_player_get_full_chapter_descriptions)(m, -1, &mut arr);
    if n > 0 && !arr.is_null() {
        for i in 0..n as usize {
            let c = *arr.add(i);
            chapters.push(json!({ "time": (*c).offset, "duration": (*c).duration, "name": cstr((*c).name).trim() }));
        }
        (a.libvlc_chapter_descriptions_release)(arr, n as c_uint);
    }

    let mut video = Value::Null;
    let mut audio_info = vec![];
    let mut sub_info = vec![];
    let mut meta = json!({});
    let media = (a.libvlc_media_player_get_media)(m);
    if !media.is_null() {
        let mut tracks: *mut *mut MediaTrack = std::ptr::null_mut();
        let count = (a.libvlc_media_tracks_get)(media, &mut tracks);
        for i in 0..count as usize {
            let t = &**tracks.add(i);
            match t.kind {
                1 if video.is_null() && !t.detail.is_null() => {
                    let v = &*(t.detail as *const VideoTrack);
                    video = json!({
                        "codec": fourcc(t.codec), "width": v.width, "height": v.height,
                        "sarNum": v.sar_num, "sarDen": v.sar_den,
                        "fps": if v.fr_den > 0 { v.fr_num as f64 / v.fr_den as f64 } else { 0.0 },
                        "bitrate": t.bitrate,
                    });
                }
                0 if !t.detail.is_null() => {
                    let au = &*(t.detail as *const AudioTrack);
                    audio_info.push(json!({
                        "id": t.id, "codec": fourcc(t.codec), "channels": au.channels, "rate": au.rate,
                        "language": cstr(t.language), "description": cstr(t.description),
                    }));
                }
                2 => sub_info.push(json!({ "id": t.id, "codec": fourcc(t.codec), "language": cstr(t.language) })),
                _ => {}
            }
        }
        if count > 0 { (a.libvlc_media_tracks_release)(tracks, count); }
        for (key, idx) in [("title", 0), ("artist", 1), ("genre", 2), ("album", 4), ("date", 8), ("nowPlaying", 12), ("artwork", 15)] {
            let p = (a.libvlc_media_get_meta)(media, idx);
            if !p.is_null() {
                meta[key] = Value::String(cstr(p));
                (a.libvlc_free)(p as P);
            }
        }
        (a.libvlc_media_release)(media);
    }

    json!({
        "ev": "tracks",
        "audio": audio, "spu": spu,
        "audioTrack": (a.libvlc_audio_get_track)(m), "spuTrack": (a.libvlc_video_get_spu)(m),
        "chapters": chapters, "chapter": (a.libvlc_media_player_get_chapter)(m),
        "video": video, "audioInfo": audio_info, "subtitleInfo": sub_info, "meta": meta,
    })
}

unsafe fn hello() -> Value {
    let a = api();
    let bands: Vec<f32> = (0..(a.libvlc_audio_equalizer_get_band_count)())
        .map(|i| (a.libvlc_audio_equalizer_get_band_frequency)(i)).collect();
    let mut presets = vec![];
    for i in 0..(a.libvlc_audio_equalizer_get_preset_count)() {
        let eq = (a.libvlc_audio_equalizer_new_from_preset)(i);
        if eq.is_null() { continue; }
        let amps: Vec<f32> = (0..bands.len() as c_uint).map(|b| (a.libvlc_audio_equalizer_get_amp_at_index)(eq, b)).collect();
        presets.push(json!({
            "index": i, "name": cstr((a.libvlc_audio_equalizer_get_preset_name)(i)),
            "preamp": (a.libvlc_audio_equalizer_get_preamp)(eq), "bands": amps,
        }));
        (a.libvlc_audio_equalizer_release)(eq);
    }
    json!({ "ev": "hello", "version": cstr((a.libvlc_get_version)()), "bands": bands, "presets": presets })
}

// ---------- commands from the UI ----------

fn num(v: &Value, k: &str, d: f64) -> f64 { v.get(k).and_then(Value::as_f64).unwrap_or(d) }

unsafe fn handle(text: &str) {
    let v: Value = match serde_json::from_str(text) { Ok(v) => v, Err(_) => return };
    let a = api();
    let m = mp();
    let cmd = v.get("cmd").and_then(Value::as_str).unwrap_or("");
    match cmd {
        "open" => {
            let path = v.get("path").and_then(Value::as_str).unwrap_or("");
            let Ok(c) = CString::new(path) else { return };
            let inst = INSTANCE.load(Ordering::Relaxed) as P;
            let media = if path.contains("://") { (a.libvlc_media_new_location)(inst, c.as_ptr()) } else { (a.libvlc_media_new_path)(inst, c.as_ptr()) };
            if media.is_null() {
                emit(json!({ "ev": "state", "state": "error", "message": format!("Could not open {}", path) }));
                return;
            }
            let mut opts: Vec<String> = v.get("options").and_then(Value::as_array)
                .map(|o| o.iter().filter_map(|x| x.as_str().map(|s| format!(":{}", s.trim_start_matches(':')))).collect())
                .unwrap_or_default();
            let start = num(&v, "start", 0.0);
            if start > 0.0 { opts.push(format!(":start-time={:.3}", start)); }
            if v.get("paused").and_then(Value::as_bool).unwrap_or(false) { opts.push(":start-paused".into()); }
            for o in opts {
                if let Ok(co) = CString::new(o) { (a.libvlc_media_add_option)(media, co.as_ptr()); }
            }
            (a.libvlc_media_player_set_media)(m, media);
            (a.libvlc_media_release)(media);
            (a.libvlc_media_player_play)(m);
            sh().loaded.store(true, Ordering::Relaxed);
            sh().tracks_dirty.store(true, Ordering::Relaxed);
        }
        "play" => { (a.libvlc_media_player_set_pause)(m, 0); }
        "pause" => { (a.libvlc_media_player_set_pause)(m, 1); }
        "toggle" => { let p = (a.libvlc_media_player_is_playing)(m); (a.libvlc_media_player_set_pause)(m, p); }
        "stop" => { sh().loaded.store(false, Ordering::Relaxed); (a.libvlc_media_player_stop)(m); }
        "seek" => (a.libvlc_media_player_set_time)(m, (num(&v, "time", 0.0) * 1000.0) as i64),
        "rate" => { (a.libvlc_media_player_set_rate)(m, num(&v, "value", 1.0) as f32); }
        "volume" => { (a.libvlc_audio_set_volume)(m, num(&v, "value", 100.0).clamp(0.0, 200.0) as c_int); }
        "mute" => (a.libvlc_audio_set_mute)(m, v.get("value").and_then(Value::as_bool).unwrap_or(false) as c_int),
        "audioTrack" => { (a.libvlc_audio_set_track)(m, num(&v, "id", -1.0) as c_int); sh().tracks_dirty.store(true, Ordering::Relaxed); }
        "spuTrack" => { (a.libvlc_video_set_spu)(m, num(&v, "id", -1.0) as c_int); sh().tracks_dirty.store(true, Ordering::Relaxed); }
        "spuDelay" => { (a.libvlc_video_set_spu_delay)(m, (num(&v, "ms", 0.0) * 1000.0) as i64); }
        "audioDelay" => { (a.libvlc_audio_set_delay)(m, (num(&v, "ms", 0.0) * 1000.0) as i64); }
        "addSubtitle" => {
            if let Some(Ok(uri)) = v.get("uri").and_then(Value::as_str).map(CString::new) {
                (a.libvlc_media_player_add_slave)(m, 0, uri.as_ptr(), true);
                sh().tracks_dirty.store(true, Ordering::Relaxed);
            }
        }
        "chapter" => (a.libvlc_media_player_set_chapter)(m, num(&v, "index", 0.0) as c_int),
        "frame" => (a.libvlc_media_player_next_frame)(m),
        "eq" => {
            if v.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
                let eq = (a.libvlc_audio_equalizer_new)();
                (a.libvlc_audio_equalizer_set_preamp)(eq, num(&v, "preamp", 0.0) as f32);
                if let Some(bands) = v.get("bands").and_then(Value::as_array) {
                    for (i, b) in bands.iter().enumerate() {
                        (a.libvlc_audio_equalizer_set_amp_at_index)(eq, b.as_f64().unwrap_or(0.0) as f32, i as c_uint);
                    }
                }
                (a.libvlc_media_player_set_equalizer)(m, eq);
                (a.libvlc_audio_equalizer_release)(eq);
            } else {
                (a.libvlc_media_player_set_equalizer)(m, std::ptr::null_mut());
            }
        }
        "adjust" => {
            let on = v.get("enabled").and_then(Value::as_bool).unwrap_or(true);
            (a.libvlc_video_set_adjust_int)(m, 0, on as c_int);
            if on {
                (a.libvlc_video_set_adjust_float)(m, 1, num(&v, "contrast", 1.0) as f32);
                (a.libvlc_video_set_adjust_float)(m, 2, num(&v, "brightness", 1.0) as f32);
                (a.libvlc_video_set_adjust_float)(m, 3, num(&v, "hue", 0.0) as f32);
                (a.libvlc_video_set_adjust_float)(m, 4, num(&v, "saturation", 1.0) as f32);
                (a.libvlc_video_set_adjust_float)(m, 5, num(&v, "gamma", 1.0) as f32);
            }
        }
        "deinterlace" => {
            let mode = v.get("mode").and_then(Value::as_str).unwrap_or("");
            if mode.is_empty() { (a.libvlc_video_set_deinterlace)(m, std::ptr::null()); }
            else if let Ok(c) = CString::new(mode) { (a.libvlc_video_set_deinterlace)(m, c.as_ptr()); }
        }
        "snapshot" => {
            if let Some(Ok(p)) = v.get("path").and_then(Value::as_str).map(CString::new) {
                (a.libvlc_video_take_snapshot)(m, 0, p.as_ptr(), 0, 0);
            }
        }
        "size" => {
            let mut f = sh().frames.lock().unwrap();
            f.max_w = num(&v, "width", 1920.0).clamp(320.0, 7680.0) as u32;
            f.max_h = num(&v, "height", 1080.0).clamp(180.0, 4320.0) as u32;
        }
        "tracks" => sh().tracks_dirty.store(true, Ordering::Relaxed),
        "quit" => { (a.libvlc_media_player_stop)(m); std::process::exit(0); }
        _ => {}
    }
}

static INSTANCE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

// ---------- WebSocket client loop ----------

fn serve(stream: TcpStream, token: &str) {
    stream.set_nodelay(true).ok();
    let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let ok = req.uri().query().map_or(false, |q| q.split('&').any(|kv| kv == format!("k={}", token)));
        if ok { Ok(resp) } else {
            Err(tungstenite::http::Response::builder().status(403).body(None).unwrap())
        }
    };
    let mut ws = match tungstenite::accept_hdr(stream, check) { Ok(w) => w, Err(_) => return };
    ws.get_ref().set_read_timeout(Some(Duration::from_millis(3))).ok();

    let (etx, erx) = mpsc::channel::<String>();
    let (ftx, frx) = mpsc::sync_channel::<Vec<u8>>(2);
    *sh().event_tx.lock().unwrap() = Some(etx);
    *sh().frame_tx.lock().unwrap() = Some(ftx);
    emit(unsafe { hello() });
    sh().tracks_dirty.store(true, Ordering::Relaxed);

    let mut dirty_at: Option<Instant> = None;
    'outer: loop {
        match ws.read() {
            Ok(Message::Text(t)) => unsafe { handle(t.as_str()) },
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(WsError::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        if sh().tracks_dirty.swap(false, Ordering::Relaxed) { dirty_at = Some(Instant::now()); }
        if dirty_at.map_or(false, |t| t.elapsed() > Duration::from_millis(150)) {
            dirty_at = None;
            if sh().loaded.load(Ordering::Relaxed) { emit(unsafe { tracks_info() }); }
        }
        while let Ok(msg) = erx.try_recv() {
            if ws.send(Message::text(msg)).is_err() { break 'outer; }
        }
        if let Ok(frame) = frx.try_recv() {
            if ws.send(Message::binary(frame)).is_err() { break 'outer; }
        }
    }
    *sh().event_tx.lock().unwrap() = None;
    *sh().frame_tx.lock().unwrap() = None;
}

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

/// Where libVLC lives on each system. Windows and macOS carry VLC next to the app; Linux uses the
/// system's libVLC (the package depends on it) unless a folder is given.
fn vlc_paths(dir: Option<&PathBuf>) -> (PathBuf, PathBuf) {
    if cfg!(target_os = "windows") {
        let d = dir.cloned().unwrap_or_else(|| std::env::current_exe().unwrap().parent().unwrap().join("vlc"));
        (d.join("libvlccore.dll"), d.join("libvlc.dll"))
    } else if cfg!(target_os = "macos") {
        // The lib and plugins folders from VLC.app/Contents/MacOS.
        let d = dir.cloned().unwrap_or_else(|| PathBuf::from("/Applications/VLC.app/Contents/MacOS"));
        std::env::set_var("VLC_PLUGIN_PATH", d.join("plugins"));
        (d.join("lib").join("libvlccore.dylib"), d.join("lib").join("libvlc.dylib"))
    } else {
        match dir {
            Some(d) if d.join("libvlc.so.5").exists() => {
                std::env::set_var("VLC_PLUGIN_PATH", d.join("plugins"));
                (d.join("libvlccore.so.9"), d.join("libvlc.so.5"))
            }
            _ => (PathBuf::from("libvlccore.so.9"), PathBuf::from("libvlc.so.5")),
        }
    }
}

fn main() {
    let vlc_dir = arg("--vlc").filter(|s| !s.is_empty()).map(PathBuf::from);
    let token = arg("--token").unwrap_or_default();

    let (core_path, lib_path) = vlc_paths(vlc_dir.as_ref());
    let (core, lib) = unsafe {
        // libvlccore first so libvlc resolves it from the same folder, not some other copy on the system.
        let core = Library::new(&core_path);
        let lib = Library::new(&lib_path);
        match (core, lib) {
            (Ok(c), Ok(l)) => (c, l),
            (c, l) => {
                eprintln!("could not load libVLC ({}): {:?} {:?}", lib_path.display(), c.err(), l.err());
                std::process::exit(2);
            }
        }
    };
    let vlc = match unsafe { Api::load(&lib) } {
        Ok(a) => a,
        Err(e) => { eprintln!("libVLC symbol missing: {}", e); std::process::exit(2); }
    };

    let vlc_args: Vec<CString> = [
        "--no-video-title-show", "--no-snapshot-preview", "--no-stats", "--no-osd", "--quiet",
        "--no-xlib", "--snapshot-format=png",
    ].iter().map(|s| CString::new(*s).unwrap()).collect();
    let argv: Vec<*const c_char> = vlc_args.iter().map(|s| s.as_ptr()).collect();
    let inst = unsafe { (vlc.libvlc_new)(argv.len() as c_int, argv.as_ptr()) };
    if inst.is_null() {
        eprintln!("libvlc_new failed: {}", unsafe { cstr((vlc.libvlc_errmsg)()) });
        std::process::exit(3);
    }
    INSTANCE.store(inst as usize, Ordering::Relaxed);
    let player = unsafe { (vlc.libvlc_media_player_new)(inst) };

    let shared = Shared {
        api: vlc, mp: player as usize,
        frames: Mutex::new(Frames { max_w: 1920, max_h: 1080, w: 0, h: 0, bufs: vec![], free: vec![] }),
        event_tx: Mutex::new(None), frame_tx: Mutex::new(None),
        tracks_dirty: AtomicBool::new(false), loaded: AtomicBool::new(false),
        last_buffering: AtomicU32::new(u32::MAX),
    };
    if SHARED.set(shared).is_err() { unreachable!() }
    std::mem::forget(core);
    std::mem::forget(lib);

    unsafe {
        let a = api();
        (a.libvlc_video_set_callbacks)(player, video_lock, video_unlock, video_display, std::ptr::null_mut());
        (a.libvlc_video_set_format_callbacks)(player, video_format, video_cleanup);
        let em = (a.libvlc_media_player_event_manager)(player);
        for kind in [0x102, 0x103, 0x104, 0x105, 0x106, 0x109, 0x10A, 0x110, 0x111, 0x112, 0x114, 0x115, 0x116, 0x11D] {
            (a.libvlc_event_attach)(em, kind, on_event, std::ptr::null_mut());
        }
    }

    // Time ticks: the UI interpolates between them, so a few per second is plenty.
    std::thread::spawn(|| {
        let mut last = (i64::MIN, i64::MIN);
        loop {
            std::thread::sleep(Duration::from_millis(200));
            if !sh().loaded.load(Ordering::Relaxed) { continue; }
            let a = api();
            let now = unsafe { ((a.libvlc_media_player_get_time)(mp()), (a.libvlc_media_player_get_length)(mp())) };
            if now != last {
                last = now;
                emit(json!({ "ev": "time", "time": now.0, "length": now.1 }));
            }
        }
    });

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind failed");
    println!("PORT {}", listener.local_addr().unwrap().port());
    std::io::stdout().flush().ok();
    for stream in listener.incoming().flatten() {
        serve(stream, &token);
    }
}
