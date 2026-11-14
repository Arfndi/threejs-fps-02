// Procedural WebAudio sounds: every effect is synthesised, no audio files, no network.
// One AudioContext, created lazily on the first user gesture (browsers require it), and a
// small pool of reusable nodes so the hot path never allocates.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
      const length = Math.floor(context.sampleRate * 0.5);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      context = null;
      return false;
    }
    return true;
  }

  // A burst of filtered noise: the body of a gunshot, a footstep, an explosion.
  function burst(when, duration, filterType, frequency, gainValue) {
    if (!context) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(when, Math.random() * 0.4, duration + 0.05);
    source.stop(when + duration + 0.1);
  }

  // A short pitched blip: beeps, clicks, the plant tick, the round-win chime.
  function tone(when, frequency, duration, type, gainValue) {
    if (!context) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  return {
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume();
    },
    shot(kind) {
      if (!ensure()) return;
      const now = context.currentTime;
      if (kind === 'rifle') {
        burst(now, 0.14, 'lowpass', 1800, 0.9);
        burst(now, 0.05, 'highpass', 2400, 0.5);
        tone(now, 180, 0.07, 'square', 0.22);
      } else if (kind === 'smg') {
        burst(now, 0.09, 'lowpass', 2200, 0.7);
        tone(now, 240, 0.05, 'square', 0.16);
      } else if (kind === 'pistol') {
        burst(now, 0.11, 'bandpass', 1400, 0.85);
        tone(now, 150, 0.06, 'square', 0.2);
      } else {
        burst(now, 0.12, 'lowpass', 1200, 0.5);
      }
    },
    distantShot() {
      if (!ensure()) return;
      burst(context.currentTime, 0.16, 'lowpass', 700, 0.22);
    },
    reload() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 900, 0.04, 'square', 0.12);
      tone(now + 0.18, 620, 0.04, 'square', 0.12);
      tone(now + 0.36, 1100, 0.05, 'square', 0.14);
    },
    dryFire() {
      if (!ensure()) return;
      tone(context.currentTime, 1400, 0.03, 'square', 0.1);
    },
    hit() {
      if (!ensure()) return;
      tone(context.currentTime, 2100, 0.05, 'sine', 0.18);
    },
    kill() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 1700, 0.06, 'sine', 0.2);
      tone(now + 0.07, 2400, 0.09, 'sine', 0.2);
    },
    hurt() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 110, 0.14, 'sawtooth', 0.25);
      burst(now, 0.1, 'lowpass', 500, 0.2);
    },
    step() {
      if (!ensure()) return;
      burst(context.currentTime, 0.05, 'lowpass', 420, 0.1);
    },
    beep() {
      if (!ensure()) return;
      tone(context.currentTime, 1250, 0.09, 'sine', 0.22);
    },
    plant() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 980, 0.08, 'sine', 0.2);
      tone(now + 0.12, 980, 0.08, 'sine', 0.2);
      tone(now + 0.24, 1320, 0.16, 'sine', 0.22);
    },
    defuse() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 880, 0.1, 'sine', 0.2);
      tone(now + 0.14, 660, 0.18, 'sine', 0.2);
    },
    explosion() {
      if (!ensure()) return;
      const now = context.currentTime;
      burst(now, 0.7, 'lowpass', 320, 1.0);
      burst(now, 0.25, 'highpass', 900, 0.4);
      tone(now, 55, 0.5, 'sine', 0.5);
    },
    roundWin() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 523, 0.14, 'triangle', 0.22);
      tone(now + 0.14, 659, 0.14, 'triangle', 0.22);
      tone(now + 0.28, 784, 0.26, 'triangle', 0.24);
    },
    roundLose() {
      if (!ensure()) return;
      const now = context.currentTime;
      tone(now, 392, 0.16, 'triangle', 0.2);
      tone(now + 0.18, 311, 0.3, 'triangle', 0.2);
    },
  };
}
