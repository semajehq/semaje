# semaje desktop capture helper

The optional desktop helper records a local audio input with ffmpeg and submits it through the
shared `/api/ingest` contract with source `desktop`. It adds no desktop runtime or Electron bundle.

```bash
npm run desktop -- --list-devices
npm run desktop -- --input ':0' --title 'Customer call'
npm run desktop -- --seconds 1800
```

macOS uses AVFoundation, Linux uses PulseAudio, and Windows uses DirectShow. For system audio,
select a loopback device such as BlackHole, a Pulse monitor source, or a Windows loopback input and
pass its ffmpeg identifier with `--input` or `DESKTOP_AUDIO_INPUT`. Team deployments also set
`DESKTOP_API_KEY`; `DESKTOP_API_BASE` defaults to `http://localhost:3001`.
