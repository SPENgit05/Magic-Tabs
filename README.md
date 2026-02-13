# Magic Tabs

Magic Tabs is a lightweight browser app that converts guitar audio into readable, playable tablature.

## Features

- Upload prerecorded audio (`.wav`, `.mp3`, etc.) and generate tabs.
- Analyze live guitar input from your microphone.
- Adjust detection sensitivity for cleaner or noisier environments.
- Map detected notes to realistic string/fret positions in standard tuning.
- Download generated tabs as a plain text (`.txt`) file.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Accuracy notes

This app uses a DSP-based autocorrelation pitch detector, which works best for:

- single-note playing,
- clean recordings,
- low background noise.

Polyphonic transcription (full chords, layered audio) generally requires a more advanced ML + DSP pipeline.
