// All sound is synthesised with WebAudio — no audio files. A slow synthwave loop (bass, pads,
// hats) under an engine hum and a two-tone siren, plus one-shot effects for fists, gunfire,
// crashes and cash. The context only starts on a user gesture, as browsers require; every call
// is a no-op until then, and M mutes the master gain.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineNodes = null;
  let sirenNodes = null;
  let musicTimer = null;
  let step = 0;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    startMusic();
  }

  function env(gain, t0, a, peak, d) {
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
  }

  function tone({ freq, freqEnd, type = 'sine', a = 0.01, d = 0.2, peak = 0.2, dest }) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + a + d);
    env(gain, t0, a, peak, d);
    osc.connect(gain);
    gain.connect(dest ?? master);
    osc.start(t0);
    osc.stop(t0 + a + d + 0.05);
  }

  function noise({ a = 0.005, d = 0.15, peak = 0.25, freq = 1200, q = 0.8 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * (a + d)));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    env(gain, t0, a, peak, d);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  // The loop: Am — F — C — G, one bar each, bass on the eighths, a pad over the top, hats on
  // the off-beats. Scheduled a step at a time from a lookahead timer.
  const BASS = [55, 55, 43.65, 43.65, 65.41, 65.41, 49, 49]; // A1 F1 C2 G1, two bars each in 8 steps
  const PADS = [
    [220, 261.63, 329.63], // Am
    [174.61, 220, 261.63], // F
    [196, 261.63, 329.63], // C/G colour
    [196, 246.94, 293.66], // G
  ];
  const STEP_SECONDS = 0.24;

  function scheduleStep() {
    if (!ctx) return;
    const s = step % 64;
    const bar = Math.floor(s / 16) % 4;
    const inBar = s % 16;
    if (inBar % 2 === 0) {
      const root = BASS[Math.floor(s / 8) % BASS.length];
      tone({ freq: root * 2, type: 'sawtooth', a: 0.01, d: 0.2, peak: 0.11 });
      tone({ freq: root, type: 'square', a: 0.01, d: 0.18, peak: 0.05 });
    }
    if (inBar === 0) {
      for (const f of PADS[bar]) tone({ freq: f, type: 'triangle', a: 0.5, d: 2.8, peak: 0.045 });
    }
    if (inBar % 4 === 2) noise({ d: 0.05, peak: 0.05, freq: 6000, q: 1.4 }); // hat
    if (inBar === 0 || inBar === 8) tone({ freq: 120, freqEnd: 40, type: 'sine', a: 0.002, d: 0.16, peak: 0.22 }); // kick
    step += 1;
  }

  function startMusic() {
    if (musicTimer) return;
    scheduleStep();
    musicTimer = setInterval(scheduleStep, STEP_SECONDS * 1000);
  }

  function setEngine(on, rpm) {
    if (!ctx) return;
    if (on && !engineNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start();
      osc2.start();
      engineNodes = { osc, osc2, gain, filter };
    }
    if (engineNodes) {
      const f = 55 + rpm * 175;
      engineNodes.osc.frequency.value = f;
      engineNodes.osc2.frequency.value = f * 0.5 + 2;
      engineNodes.filter.frequency.value = 320 + rpm * 700;
      engineNodes.gain.gain.value = on ? 0.075 : 0;
      if (!on) {
        const nodes = engineNodes;
        engineNodes = null;
        setTimeout(() => { try { nodes.osc.stop(); nodes.osc2.stop(); } catch { /* already stopped */ } }, 120);
      }
    }
  }

  function setSiren(on, level) {
    if (!ctx) return;
    if (on && !sirenNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 800;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.55;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 130;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      lfo.start();
      sirenNodes = { osc, lfo, gain };
    }
    if (sirenNodes) {
      sirenNodes.gain.gain.value = on ? Math.min(0.06, level) : 0;
      if (!on) {
        const nodes = sirenNodes;
        sirenNodes = null;
        setTimeout(() => { try { nodes.osc.stop(); nodes.lfo.stop(); } catch { /* already stopped */ } }, 120);
      }
    }
  }

  return {
    init,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() { return muted; },
    setEngine,
    setSiren,
    punch() { noise({ d: 0.09, peak: 0.3, freq: 300, q: 0.6 }); tone({ freq: 90, freqEnd: 45, d: 0.1, peak: 0.2 }); },
    shot() { noise({ d: 0.14, peak: 0.5, freq: 2400, q: 0.4 }); tone({ freq: 160, freqEnd: 50, d: 0.1, peak: 0.3 }); },
    dryFire() { tone({ freq: 1400, d: 0.03, peak: 0.08, type: 'square' }); },
    crash(intensity) {
      const k = Math.min(1, intensity / 16);
      noise({ d: 0.25 + k * 0.2, peak: 0.2 + k * 0.35, freq: 500, q: 0.5 });
      tone({ freq: 70, freqEnd: 32, d: 0.3, peak: 0.25 * k + 0.08 });
    },
    cash() {
      tone({ freq: 1318, d: 0.09, peak: 0.14, type: 'square' });
      setTimeout(() => tone({ freq: 1760, d: 0.16, peak: 0.14, type: 'square' }), 70);
    },
    pickup() { tone({ freq: 660, freqEnd: 990, d: 0.12, peak: 0.16, type: 'triangle' }); },
    complete() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => setTimeout(() => tone({ freq: f, d: 0.24, peak: 0.16, type: 'triangle' }), i * 95));
    },
    denied() { tone({ freq: 196, freqEnd: 147, d: 0.16, peak: 0.15, type: 'square' }); },
    sting() { tone({ freq: 392, freqEnd: 98, d: 0.7, peak: 0.22, type: 'sawtooth' }); },
    click() { tone({ freq: 880, d: 0.05, peak: 0.1, type: 'square' }); },
  };
}
