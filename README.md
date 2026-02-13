# Magic Tabs

Magic Tabs is a browser app that converts guitar audio into playable tablature.

## Features

- Record guitar directly in the app and see a live waveform while recording.
- Upload prerecorded audio files (`.wav`, `.mp3`, etc.).
- Analyze only when a valid source exists (recording or uploaded file).
- Watch real-time analysis progress with a live progress bar.
- View large, centered tab output and download as `.txt`.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Basic flow

1. Record audio **or** upload a file.
2. Click **Analyze**.
3. Wait for the progress bar to reach 100%.
4. Read tabs in the lower panel and optionally download them.
