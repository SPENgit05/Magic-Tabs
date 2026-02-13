const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64];
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
const MAX_FRET = 22;

const audioFileInput = document.getElementById('audioFile');
const recordBtn = document.getElementById('recordBtn');
const recordBtnLabel = document.getElementById('recordBtnLabel');
const analyzeBtn = document.getElementById('analyzeBtn');
const clearBtn = document.getElementById('clearBtn');
const tabOutput = document.getElementById('tabOutput');
const downloadTabBtn = document.getElementById('downloadTabBtn');
const statusText = document.getElementById('statusText');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const waveCanvas = document.getElementById('waveCanvas');
const waveCtx = waveCanvas.getContext('2d');

const EMPTY_TAB = `e|--------------------------------|\nB|--------------------------------|\nG|--------------------------------|\nD|--------------------------------|\nA|--------------------------------|\nE|--------------------------------|`;

const state = {
  stream: null,
  context: null,
  source: null,
  analyser: null,
  rafId: null,
  isRecording: false,
  chunks: [],
  recordedSamples: null,
  recordedSampleRate: 44100,
  isAnalyzing: false
};

audioFileInput.addEventListener('change', () => {
  if (audioFileInput.files?.[0]) {
    state.recordedSamples = null;
    statusText.textContent = 'Media selected. Click Analyze.';
  }
  updateAnalyzeEnabled();
});

recordBtn.addEventListener('click', async () => {
  if (state.isAnalyzing) return;
  if (state.isRecording) stopRecording();
  else await startRecording();
});

analyzeBtn.addEventListener('click', analyzeCurrentSource);
clearBtn.addEventListener('click', clearAll);
downloadTabBtn.addEventListener('click', downloadCurrentTab);

drawIdleWave();

function updateAnalyzeEnabled() {
  const hasFile = Boolean(audioFileInput.files?.[0]);
  const hasRecording = Boolean(state.recordedSamples?.length);
  analyzeBtn.disabled = state.isAnalyzing || !(hasFile || hasRecording);
}

function setProgress(percent) {
  const p = Math.max(0, Math.min(100, percent));
  progressBar.style.width = `${p.toFixed(1)}%`;
  progressLabel.textContent = `Analyzing ${Math.round(p)}%`;
}

async function startRecording() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    state.context = new AudioContext();
    await state.context.resume();
    state.source = state.context.createMediaStreamSource(state.stream);
    state.analyser = state.context.createAnalyser();
    state.analyser.fftSize = 2048;
    state.source.connect(state.analyser);

    state.isRecording = true;
    state.chunks = [];
    audioFileInput.value = '';
    state.recordedSamples = null;

    recordBtn.setAttribute('aria-pressed', 'true');
    recordBtnLabel.textContent = 'Stop';
    statusText.textContent = 'Recording... play your guitar now.';
    updateAnalyzeEnabled();

    const frame = new Float32Array(state.analyser.fftSize);
    const loop = () => {
      state.analyser.getFloatTimeDomainData(frame);
      state.chunks.push(new Float32Array(frame));
      drawWave(frame);
      const peak = frame.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      if (peak < 0.005) statusText.textContent = 'Recording... waiting for input signal.';
      else statusText.textContent = 'Recording... signal detected.';
      state.rafId = requestAnimationFrame(loop);
    };
    loop();
  } catch (err) {
    statusText.textContent = `Microphone error: ${err.message}`;
  }
}

function stopRecording() {
  if (!state.isRecording) return;

  state.isRecording = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.context?.close();

  const total = state.chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of state.chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  state.recordedSamples = merged.length ? merged : null;
  state.recordedSampleRate = state.context?.sampleRate || 44100;

  state.stream = null;
  state.context = null;
  state.source = null;
  state.analyser = null;
  state.chunks = [];

  recordBtn.setAttribute('aria-pressed', 'false');
  recordBtnLabel.textContent = 'Record';

  if (state.recordedSamples) {
    statusText.textContent = 'Recording captured. Click Analyze.';
  } else {
    statusText.textContent = 'No audio captured. Try recording again.';
    drawIdleWave();
  }

  updateAnalyzeEnabled();
}

async function analyzeCurrentSource() {
  if (state.isAnalyzing) return;
  state.isAnalyzing = true;
  updateAnalyzeEnabled();
  recordBtn.disabled = true;
  audioFileInput.disabled = true;
  progressWrap.hidden = false;
  setProgress(0);

  try {
    let samples;
    let sampleRate;

    let analysisStart = 0;
    const file = audioFileInput.files?.[0];
    if (file) {
      statusText.textContent = 'Reading uploaded media...';
      ({ samples, sampleRate } = await loadSamplesFromFile(file));
      analysisStart = 35;
    } else if (state.recordedSamples) {
      statusText.textContent = 'Analyzing recorded audio...';
      samples = state.recordedSamples;
      sampleRate = state.recordedSampleRate;
    } else {
      throw new Error('Select a file or record audio first.');
    }

    const notes = await extractNotesAsync(samples, sampleRate, (p) => setProgress(analysisStart + p * (100 - analysisStart))); 
    renderTab(notes);
    setProgress(100);
    statusText.textContent = notes.length
      ? `Analysis complete. ${notes.length} note events detected.`
      : 'Analysis complete, but no confident notes were found.';
  } catch (err) {
    statusText.textContent = `Analysis failed: ${err.message}`;
  } finally {
    state.isAnalyzing = false;
    recordBtn.disabled = false;
    audioFileInput.disabled = false;
    updateAnalyzeEnabled();
  }
}


async function loadSamplesFromFile(file) {
  const type = file.type || '';

  if (type.startsWith('video/')) {
    statusText.textContent = 'Extracting audio from video...';
    return extractSamplesWithMediaElement(file, (p) => setProgress(p * 0.35));
  }

  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    await context.close();
    return { samples: channel, sampleRate };
  } catch (_err) {
    statusText.textContent = 'Fallback media decode in progress...';
    return extractSamplesWithMediaElement(file, (p) => setProgress(p * 0.35));
  }
}

async function extractSamplesWithMediaElement(file, onProgress) {
  const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
  media.preload = 'auto';
  media.muted = true;
  media.playsInline = true;
  media.src = URL.createObjectURL(file);

  await new Promise((resolve, reject) => {
    media.onloadedmetadata = resolve;
    media.onerror = () => reject(new Error('Unsupported media format or codec.'));
  });

  const context = new AudioContext();
  await context.resume();
  const source = context.createMediaElementSource(media);
  const analyser = context.createAnalyser();
  const sink = context.createGain();
  sink.gain.value = 0;
  analyser.fftSize = 2048;
  source.connect(analyser);
  analyser.connect(sink);
  sink.connect(context.destination);

  const frame = new Float32Array(analyser.fftSize);
  const chunks = [];

  await media.play();
  await new Promise((resolve) => {
    const loop = () => {
      analyser.getFloatTimeDomainData(frame);
      chunks.push(new Float32Array(frame));
      drawWave(frame);

      const duration = media.duration || 0;
      const ratio = duration > 0 ? media.currentTime / duration : 0;
      onProgress(Math.max(0, Math.min(1, ratio)));

      if (media.ended) {
        resolve();
      } else {
        requestAnimationFrame(loop);
      }
    };
    loop();
  });

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  URL.revokeObjectURL(media.src);
  media.remove();
  await context.close();

  return { samples: merged, sampleRate: context.sampleRate || 44100 };
}

async function extractNotesAsync(samples, sampleRate, onProgress) {
  const frameSize = 2048;
  const hopSize = 1024;
  const minHz = 70;
  const maxHz = 1200;
  const confidenceThreshold = 0.55;
  const raw = [];

  const totalSteps = Math.max(1, Math.floor((samples.length - frameSize) / hopSize));
  let step = 0;

  for (let i = 0; i + frameSize < samples.length; i += hopSize) {
    const frame = samples.slice(i, i + frameSize);
    const detection = detectPitchAutoCorrelation(frame, sampleRate, minHz, maxHz);
    if (detection && detection.confidence >= confidenceThreshold) {
      raw.push({
        midi: frequencyToMidi(detection.frequency),
        frequency: detection.frequency,
        time: i / sampleRate,
        confidence: detection.confidence
      });
    }

    step += 1;
    if (step % 12 === 0) {
      onProgress((step / totalSteps) * 100);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  onProgress(100);
  return smoothAndReduce(raw);
}

function smoothAndReduce(events) {
  if (!events.length) return [];
  const grouped = [];
  let current = { ...events[0], count: 1 };

  for (let i = 1; i < events.length; i++) {
    const e = events[i];
    const closeInPitch = Math.abs(e.midi - current.midi) <= 1;
    const closeInTime = e.time - current.time < 0.17;

    if (closeInPitch && closeInTime) {
      current.midi = Math.round((current.midi * current.count + e.midi) / (current.count + 1));
      current.frequency = (current.frequency * current.count + e.frequency) / (current.count + 1);
      current.confidence = Math.max(current.confidence, e.confidence);
      current.count += 1;
    } else {
      grouped.push(current);
      current = { ...e, count: 1 };
    }
  }

  grouped.push(current);
  return grouped;
}

function detectPitchAutoCorrelation(buffer, sampleRate, minHz = 70, maxHz = 1200) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return null;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < buffer.length - lag; i++) corr += buffer[i] * buffer[i + lag];
    corr /= buffer.length;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag === -1) return null;
  return { frequency: sampleRate / bestLag, confidence: Math.min(1, bestCorr * 12) };
}

function frequencyToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function getPlayablePositions(midi) {
  const positions = [];
  STANDARD_TUNING_MIDI.forEach((openMidi, stringIndex) => {
    const fret = midi - openMidi;
    if (fret >= 0 && fret <= MAX_FRET) positions.push({ stringIndex, fret });
  });
  return positions;
}

function choosePosition(midi, previous = null) {
  const positions = getPlayablePositions(midi);
  if (!positions.length) return null;
  if (!previous) return positions.reduce((b, p) => (p.fret < b.fret ? p : b), positions[0]);

  return positions.reduce((best, pos) => {
    const travel = Math.abs(pos.fret - previous.fret) + Math.abs(pos.stringIndex - previous.stringIndex) * 1.5;
    const bestTravel = Math.abs(best.fret - previous.fret) + Math.abs(best.stringIndex - previous.stringIndex) * 1.5;
    return travel < bestTravel ? pos : best;
  }, positions[0]);
}

function buildTab(events) {
  const lines = { e: [], B: [], G: [], D: [], A: [], E: [] };
  const resolution = Math.max(56, events.length * 3);
  for (const key of Object.keys(lines)) lines[key] = Array(resolution).fill('-');

  let previousPos = null;
  events.forEach((event, index) => {
    const pos = choosePosition(event.midi, previousPos);
    if (!pos) return;
    const stringName = STRING_NAMES[pos.stringIndex];
    const slot = Math.floor((index / Math.max(1, events.length - 1)) * (resolution - 1));
    lines[stringName][slot] = String(pos.fret);
    previousPos = pos;
  });

  return ['e', 'B', 'G', 'D', 'A', 'E'].map((n) => `${n}|${lines[n].join('')}|`).join('\n');
}

function renderTab(notes) {
  tabOutput.textContent = notes.length ? buildTab(notes) : EMPTY_TAB;
}

function clearAll() {
  if (state.isRecording) stopRecording();
  audioFileInput.value = '';
  state.recordedSamples = null;
  progressWrap.hidden = true;
  setProgress(0);
  renderTab([]);
  statusText.textContent = 'Cleared. Select a file or record audio to begin.';
  drawIdleWave();
  updateAnalyzeEnabled();
}

function downloadCurrentTab() {
  const content = tabOutput.textContent?.trim() || EMPTY_TAB;
  const blob = new Blob([`${content}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const link = document.createElement('a');
  link.href = url;
  link.download = `magic-tabs-${stamp}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function drawIdleWave() {
  waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
  waveCtx.strokeStyle = '#a7b3cb';
  waveCtx.lineWidth = 2;
  waveCtx.beginPath();
  const mid = waveCanvas.height / 2;
  waveCtx.moveTo(0, mid);
  waveCtx.lineTo(waveCanvas.width, mid);
  waveCtx.stroke();
}

function drawWave(data) {
  waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
  waveCtx.lineWidth = 2;
  waveCtx.strokeStyle = '#2a5ef4';
  waveCtx.beginPath();

  const sliceWidth = waveCanvas.width / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const y = ((data[i] + 1) / 2) * waveCanvas.height;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
    x += sliceWidth;
  }
  waveCtx.stroke();
}
