# Edion

A sleek, cross-platform video editor built on Electron, WebGL and FFmpeg.

## Features

- **Timeline** — multi-track video / audio / caption tracks; move, trim, split (razor), ripple / roll / slip / slide tools, ripple trim to playhead (Q / W), close gaps, ripple delete, snapping, multi-select, copy / paste / duplicate, linked clips (a video and its detached audio edit together; Alt-drag edits one side), named and coloured markers (drag to move, copy as YouTube chapters), jump to previous / next edit or marker, in/out range, full undo/redo.
- **Media** — video, audio and images; search and type filter, in-use badges, remove unused media, collect all files into one folder; filmstrip thumbnails and waveforms; missing-media relinking; automatic **proxies** for 4K / HEVC / AV1 / ProRes footage and for formats Chromium can't decode.
- **Text, shapes, captions** — styled titles (fonts, outline, shadow, box), rectangles and ellipses, a caption track with SRT / VTT import and export (burned in on export).
- **Animation** — keyframes on position, scale, rotation, opacity, volume and every effect parameter, with easing; entrance / exit presets; on-canvas move / scale / rotate gizmo.
- **Effects and transitions** — colour adjust, levels, blur, sharpen, glow, drop shadow, blurred background fill (for vertical or letterboxed footage), vignette, sepia, invert, pixelate, chromatic aberration, film grain, chroma key, luma key, .cube LUTs, rectangle / ellipse masks (feathered, keyframeable); adjustment layers that apply effects to everything below them; blend modes; 13 transitions, whose sound crossfades too (equal power), plus crossfades between audio clips.
- **Viewer** — video scopes (luma waveform, vectorscope, RGB histogram), safe-area and rule-of-thirds guides, preview quality.
- **Clean-up** — video stabilization (vid.stab) and audio noise reduction, written as processed copies next to the project.
- **Time** — per-clip speed, reverse playback (picture and sound), frame holds inserted at the playhead.
- **Audio** — per-clip volume with keyframes, fades, pan, equalizer / high-pass / low-pass / compressor, loudness normalization to -14 LUFS (EBU R128), remove silence (automatic jump cuts), noise reduction, a mixer with per-track volume and pan, detach audio, mute / solo, level meter, voiceover recording.
- **Projects** — single `.edion` JSON file with linked media, atomic saves with a `.bak`, autosave and crash recovery, recent projects.
- **Export** — MP4 (H.264 / H.265 / AV1), WebM (VP9 + Opus), MOV (ProRes 422), animated GIF, audio only (MP3, WAV, FLAC) and PNG stills of the frame at the playhead; resolution and quality presets, in/out range, background queue with progress / ETA / cancel, hardware encoding (NVENC, VAAPI, Quick Sync, AMF, VideoToolbox) with automatic software fallback.

## Development

Requires Node 22+ and pnpm. The end-to-end tests also need `ffmpeg` / `ffprobe` on the PATH.

```sh
pnpm install
pnpm dev            # run the app with hot reload
pnpm test           # unit tests for the editing core
pnpm test:export    # builds the app and renders real projects headlessly (no window, no sound)
pnpm typecheck
pnpm dist           # installers for the current OS (dist:dir for an unpacked build)
pnpm dist:pacman    # Arch package (install with: sudo pacman -U dist/edion-0.1.0.pacman)
```

## Releasing

Releases are built by GitHub Actions whenever the `release` branch is pushed. Bump `version` in
`package.json`, then:

```sh
git checkout release && git merge main && git push origin release
```

The workflow runs the tests, builds the Linux AppImage and pacman package, the Windows installer and
the macOS disk image, tags the commit `v<version>`, and publishes everything (plus a `SHA256SUMS.txt`)
as a GitHub Release. If a release for that version already exists the build stops, so every push to
`release` needs a new version number. Versions containing a `-` (`0.2.0-beta.1`) are published as
pre-releases. Builds are unsigned: macOS will warn on first launch (right-click → Open), and Windows
SmartScreen may ask for confirmation.

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

`EDION_HEADLESS_EXPORT=<project.edion>::<output>[::auto|software|<encoder>[::<format id>]]` exports and exits; the format follows the output's extension unless given.
`EDION_SCREENSHOT=<png>` renders the editor offscreen (never shown, muted), optionally runs
`EDION_DEBUG_SCRIPT=<js>` in the page, saves a screenshot and exits. `EDION_OPEN=<project>` opens a project.

## Licensing note

The bundled FFmpeg builds (`ffmpeg-static`, `ffprobe-static`) are GPL. That is why this project is
GPL-3.0-or-later; keep it in mind before redistributing under different terms.
