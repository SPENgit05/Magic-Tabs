const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
const MAX_FRET = 22;

const audioFileInput = document.getElementById('audioFile');
const analyzeFileBtn = document.getElementById('analyzeFileBtn');
const tabOutput = document.getElementById('tabOutput');
const summary = document.getElementById('summary');
const liveNote = document.getElementById('liveNote');
const recordLiveBtn = document.getElementById('recordLiveBtn');
const recordBtnLabel = document.getElementById('recordBtnLabel');
const clearLiveBtn = document.getElementById('clearLiveBtn');
const minConfidence = document.getElementById('minConfidence');
const confidenceLabel = document.getElementById('confidenceLabel');
const downloadTabBtn = document.getElementById('downloadTabBtn');
const fileStatus = document.getElementById('fileStatus');
const liveStatus = document.getElementById('liveStatus');
const fileStatusText = document.getElementById('fileStatusText');
const liveStatusText = document.getElementById('liveStatusText');


const EMPTY_TAB = `e|--------------------------------|
B|--------------------------------|
G|--------------------------------|
D|--------------------------------|
A|--------------------------------|
E|--------------------------------|`;

let liveState = {
  stream: null,
  context: null,
  source: null,
  analyser: null,
  rafId: null,
  liveNotes: []
};

minConfidence.addEventListener('input', () => {
  confidenceLabel.textContent = minConfidence.value;
});

analyzeFileBtn.addEventListener('click', async () => {
  setProcessStatus('file', 'running', 'Analyzing…');
  const file = audioFileInput.files?.[0];
  if (!file) {
    setSummary(['Please upload an audio file first.']);
    setProcessStatus('file', 'error', 'No file selected');
    return;
  }

  setSummary(['Analyzing file…']);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channel = audioBuffer.getChannelData(0);

    const notes = extractNotes(channel, audioBuffer.sampleRate, parseFloat(minConfidence.value));
    renderAnalysis(notes, `File: ${file.name}`, audioBuffer.duration);
    setProcessStatus('file', 'done', 'Completed');
    audioContext.close();
  } catch (err) {
    setSummary([`Analysis failed: ${err.message}`]);
    setProcessStatus('file', 'error', 'Failed');
  }
});

recordLiveBtn.addEventListener('click', toggleLiveAnalysis);
clearLiveBtn.addEventListener('click', () => {
  liveState.liveNotes = [];
  renderTab([]);
  setSummary(['Live tab cleared.']);
  setProcessStatus('live', 'idle', 'Idle');
});

downloadTabBtn.addEventListener('click', downloadCurrentTab);

function setSummary(items) {
  summary.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
}


function setProcessStatus(kind, state, text) {
  const isFile = kind === 'file';
  const wrapper = isFile ? fileStatus : liveStatus;
  const label = isFile ? fileStatusText : liveStatusText;
  wrapper.dataset.state = state;
  label.textContent = text;
}


function extractNotes(samples, sampleRate, confidenceThreshold = 0.55) {
  const frameSize = 2048;
  const hopSize = 1024;
  const minHz = 70;
  const maxHz = 1200;
  const raw = [];

  for (let i = 0; i + frameSize < samples.length; i += hopSize) {
    const frame = samples.slice(i, i + frameSize);
    const detection = detectPitchAutoCorrelation(frame, sampleRate, minHz, maxHz);
    if (detection && detection.confidence >= confidenceThreshold) {
      const midi = frequencyToMidi(detection.frequency);
      raw.push({
        midi,
        frequency: detection.frequency,
        time: i / sampleRate,
        confidence: detection.confidence
      });
    }
  }

  return smoothAndReduce(raw);
}

function smoothAndReduce(events) {
  if (events.length === 0) return [];
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
    for (let i = 0; i < buffer.length - lag; i++) {
      corr += buffer[i] * buffer[i + lag];
    }
    corr /= buffer.length;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag === -1) return null;

  const frequency = sampleRate / bestLag;
  const confidence = Math.min(1, bestCorr * 12);
  return { frequency, confidence };
}

function frequencyToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function midiToNoteName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function getPlayablePositions(midi) {
  const positions = [];
  STANDARD_TUNING_MIDI.forEach((openMidi, stringIndex) => {
    const fret = midi - openMidi;
    if (fret >= 0 && fret <= MAX_FRET) {
      positions.push({ stringIndex, fret });
    }
  });
  return positions;
}

function choosePosition(midi, previous = null) {
  const positions = getPlayablePositions(midi);
  if (!positions.length) return null;

  if (!previous) {
    return positions.reduce((best, pos) => (pos.fret < best.fret ? pos : best), positions[0]);
  }

  return positions.reduce((best, pos) => {
    const travel = Math.abs(pos.fret - previous.fret) + Math.abs(pos.stringIndex - previous.stringIndex) * 1.5;
    const bestTravel = Math.abs(best.fret - previous.fret) + Math.abs(best.stringIndex - previous.stringIndex) * 1.5;
    return travel < bestTravel ? pos : best;
  }, positions[0]);
}

function buildTab(events) {
  const lines = {
    e: [],
    B: [],
    G: [],
    D: [],
    A: [],
    E: []
  };

  const resolution = Math.max(40, events.length * 3);
  for (const key of Object.keys(lines)) {
    lines[key] = Array(resolution).fill('-');
  }

  let previousPos = null;
  events.forEach((event, index) => {
    const pos = choosePosition(event.midi, previousPos);
    if (!pos) return;

    const stringName = STRING_NAMES[pos.stringIndex];
    const slot = Math.floor((index / Math.max(1, events.length - 1)) * (resolution - 1));
    const fretText = String(pos.fret);

    lines[stringName][slot] = fretText;
    previousPos = pos;
  });

  return ['e', 'B', 'G', 'D', 'A', 'E']
    .map((name) => `${name}|${lines[name].join('')}|`)
    .join('\n');
}

function renderAnalysis(notes, sourceLabel, duration) {
  if (!notes.length) {
    renderTab([]);
    setSummary([
      `${sourceLabel}`,
      'No confident notes detected. Try lowering sensitivity or using cleaner input.'
    ]);
    return;
  }

  renderTab(notes);
  const uniqueNotes = new Set(notes.map((n) => midiToNoteName(n.midi)));
  setSummary([
    `${sourceLabel}`,
    `Duration analyzed: ${duration.toFixed(2)}s`,
    `Detected notes: ${notes.length}`,
    `Unique pitches: ${[...uniqueNotes].slice(0, 10).join(', ')}${uniqueNotes.size > 10 ? '…' : ''}`
  ]);
}

function renderTab(notes) {
  const tab = notes.length ? buildTab(notes) : EMPTY_TAB;
  tabOutput.textContent = tab;
}

function toggleLiveAnalysis() {
  if (liveState.stream) {
    stopLiveAnalysis();
    return;
  }

  startLiveAnalysis();
}

async function startLiveAnalysis() {
  if (liveState.stream) return;

  try {
    liveState.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    liveState.context = new AudioContext();
    liveState.source = liveState.context.createMediaStreamSource(liveState.stream);
    liveState.analyser = liveState.context.createAnalyser();
    liveState.analyser.fftSize = 2048;
    liveState.source.connect(liveState.analyser);

    recordLiveBtn.setAttribute('aria-pressed', 'true');
    recordBtnLabel.textContent = 'Stop';
    setProcessStatus('live', 'running', 'Recording');

    const buffer = new Float32Array(liveState.analyser.fftSize);
    let previousCapture = 0;

    const tick = () => {
      liveState.analyser.getFloatTimeDomainData(buffer);
      const result = detectPitchAutoCorrelation(buffer, liveState.context.sampleRate, 70, 1200);

      if (result && result.confidence >= parseFloat(minConfidence.value)) {
        const midi = frequencyToMidi(result.frequency);
        liveNote.textContent = `${midiToNoteName(midi)} (${result.frequency.toFixed(1)}Hz)`;

        const now = performance.now();
        if (now - previousCapture > 220) {
          liveState.liveNotes.push({ midi, frequency: result.frequency, confidence: result.confidence, time: now / 1000 });
          liveState.liveNotes = smoothAndReduce(liveState.liveNotes).slice(-48);
          renderTab(liveState.liveNotes);
          previousCapture = now;
        }
      }

      liveState.rafId = requestAnimationFrame(tick);
    };

    tick();
    setSummary(['Live analysis started. Play single notes for the best tab quality.']);
  } catch (err) {
    setSummary([`Unable to access microphone: ${err.message}`]);
    setProcessStatus('live', 'error', 'Mic error');
  }
}

function stopLiveAnalysis() {
  if (!liveState.stream) return;

  if (liveState.rafId) cancelAnimationFrame(liveState.rafId);
  liveState.stream.getTracks().forEach((track) => track.stop());
  liveState.context?.close();

  liveState = {
    stream: null,
    context: null,
    source: null,
    analyser: null,
    rafId: null,
    liveNotes: liveState.liveNotes
  };

  liveNote.textContent = '—';
  recordLiveBtn.setAttribute('aria-pressed', 'false');
  recordBtnLabel.textContent = 'Record';
  setProcessStatus('live', 'done', 'Stopped');
  setSummary(['Live analysis stopped.']);
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
  setSummary(['Tab downloaded.', 'You can open the .txt file in any editor or tab software.']);
}
