# Edion

A sleek, cross-platform video editor built on Electron, WebGL and FFmpeg.

## Features

- **Timeline** — multi-track video / audio / caption tracks; move, trim, split (razor), ripple delete, snapping, multi-select, copy / paste / duplicate, markers, in/out range, full undo/redo.
- **Media** — video, audio and images; filmstrip thumbnails and waveforms; missing-media relinking; automatic **proxies** for 4K / HEVC / AV1 / ProRes footage and for formats Chromium can't decode.
- **Text, shapes, captions** — styled titles (fonts, outline, shadow, box), rectangles and ellipses, a caption track with SRT / VTT import and export (burned in on export).
- **Animation** — keyframes on position, scale, rotation, opacity, volume and every effect parameter, with easing; entrance / exit presets; on-canvas move / scale / rotate gizmo.
- **Effects and transitions** — colour adjust, blur, sharpen, vignette, sepia, invert, pixelate, chroma key; blend modes; 13 transitions.
- **Audio** — per-clip volume with keyframes, fades, detach audio, mute / solo, level meter, voiceover recording.
- **Projects** — single `.edion` JSON file with linked media, atomic saves with a `.bak`, autosave and crash recovery, recent projects.
- **Export** — MP4 (H.264 + AAC), resolution and quality presets, in/out range, background queue with progress / ETA / cancel, hardware encoding (NVENC, VAAPI, Quick Sync, AMF, VideoToolbox) with automatic software fallback.

## Development

Requires Node 22+ and pnpm. The end-to-end tests also need `ffmpeg` / `ffprobe` on the PATH.

```sh
pnpm install
pnpm dev            # run the app with hot reload
pnpm test           # unit tests for the editing core
pnpm test:export    # builds the app and renders real projects headlessly (no window, no sound)
pnpm typecheck
pnpm dist           # installers for the current OS (dist:dir for an unpacked build)
```

## Architecture

```
src/core       Pure TypeScript, no DOM/Electron: project schema (zod), timeline operations,
               keyframes, undo history, scene evaluation. Unit-tested; everything else builds on it.
src/main       Electron main: project IO, settings, FFmpeg services (probe, filmstrips, waveform
               peaks, proxies, encoder detection), export queue.
src/preload    Typed bridges: `window.edion` (editor) and `window.edionExport` (export worker).
src/renderer   React UI + engine (WebCodecs decoding via mediabunny, WebGL2 compositor,
               Web Audio playback, export worker).
```

The key design decision: **one compositor renders both the preview and the export.**
`evaluateScene(project, frame)` turns the project into a flat list of resolved layers; the WebGL
`Compositor` draws it. The preview draws whatever frames are decoded (non-blocking); the export worker —
a hidden window — waits for the exact frame of every layer, reads the pixels back and pipes raw RGBA
into FFmpeg, which only encodes. Audio is mixed offline with the same scheduling code used for live
playback. So what you see is what you export.

Timeline times are integer frames; source offsets are seconds. Every property that can be animated is an
`Animatable<T>` (`{ value, keyframes? }`).

### Testing without a window

`EDION_HEADLESS_EXPORT=<project.edion>::<out.mp4>[::auto|software|<encoder>]` exports and exits.
`EDION_SCREENSHOT=<png>` renders the editor offscreen (never shown, muted), optionally runs
`EDION_DEBUG_SCRIPT=<js>` in the page, saves a screenshot and exits. `EDION_OPEN=<project>` opens a project.

## Licensing note

The bundled FFmpeg builds (`ffmpeg-static`, `ffprobe-static`) are GPL. That is why this project is
GPL-3.0-or-later; keep it in mind before redistributing under different terms.
