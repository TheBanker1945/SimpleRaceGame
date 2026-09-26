import * as THREE from 'three';
import { clamp, clamp01 } from '../core/math.ts';

/** Per-frame state of the player car relevant to sound. */
export interface CarSoundState {
  rpm: number;
  idleRPM: number;
  limiterRPM: number;
  /** Engine load 0..1 (throttle actually reaching the engine). */
  load: number;
  throttle: number;
  limiterCutting: boolean;
  /** Speed over ground (m/s). */
  speed: number;
  /** Largest normalised tire slip (1 = at the grip limit). */
  slip: number;
  onRumbleStrip: boolean;
  /** Seconds since the last barrier/traffic scrape contact. */
  scrapeAge: number;
}

/** A traffic vehicle that can be heard. */
export interface SoundSource {
  id: number;
  position: THREE.Vector3;
  /** Engine hum base frequency (Hz) and relative loudness. */
  hum: number;
  loudness: number;
  speed: number;
}

interface Voice {
  sourceId: number;
  noise: AudioBufferSourceNode;
  osc: OscillatorNode;
  roarFilter: BiquadFilterNode;
  humFilter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  lastDistance: number;
  doppler: number;
}

const SPEED_OF_SOUND = 343;
const tmpVec = new THREE.Vector3();

/**
 * Fully synthesized sound: no audio files. Engine = harmonic oscillator stack that
 * follows the firing frequency of a six-cylinder (rpm/20 Hz) with load-dependent
 * distortion and filtering, plus intake noise; tires, wind and road from filtered noise;
 * traffic from four doppler-shifted, panned voices; one-shots for shifts, crashes,
 * horns and near-miss whooshes.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private brownBuffer!: AudioBuffer;

  // Engine chain
  private engineOsc1!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineOsc3!: OscillatorNode;
  private enginePre!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;

  // Continuous noise layers
  private screechFilterA!: BiquadFilterNode;
  private screechFilterB!: BiquadFilterNode;
  private screechGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private roadGain!: GainNode;
  private rumbleOsc!: OscillatorNode;
  private rumbleGain!: GainNode;
  private scrapeGain!: GainNode;

  private readonly voices: Voice[] = [];
  private volume = 0.7;
  private lastThrottle = 0;
  private lastRpm = 0;
  private popsUntil = 0;
  private nextPop = 0;
  private time = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(compressor);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    this.noiseBuffer = this.makeNoise(2, false);
    this.brownBuffer = this.makeNoise(2, true);
    this.buildEngine(ctx);
    this.buildNoiseLayers(ctx);
    for (let i = 0; i < 4; i++) this.voices.push(this.buildVoice(ctx));
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  // ------------------------------------------------------------------ building

  private makeNoise(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  private loopNoise(ctx: AudioContext, brown = false): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brownBuffer : this.noiseBuffer;
    src.loop = true;
    // Random start offset so layers never phase-align.
    src.start(0, Math.random() * 1.5);
    return src;
  }

  private buildEngine(ctx: AudioContext): void {
    // Six-cylinder firing spectrum: strong low orders, a few emphasized odd orders for rasp.
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      let a = 1 / Math.pow(k, 0.9);
      if (k === 3 || k === 5) a *= 1.6;
      if (k % 2 === 0) a *= 0.75;
      imag[k] = a * (Math.random() * 0.4 + 0.8);
    }
    const wave = ctx.createPeriodicWave(real, imag);
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.setPeriodicWave(wave);
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc3 = ctx.createOscillator();
    this.engineOsc3.type = 'triangle';
    const g1 = ctx.createGain();
    g1.gain.value = 0.55;
    const g2 = ctx.createGain();
    g2.gain.value = 0.2;
    const g3 = ctx.createGain();
    g3.gain.value = 0.35;
    this.enginePre = ctx.createGain();
    this.enginePre.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc1.connect(g1).connect(this.enginePre);
    this.engineOsc2.connect(g2).connect(this.enginePre);
    this.engineOsc3.connect(g3).connect(this.enginePre);
    this.enginePre.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc1.start();
    this.engineOsc2.start();
    this.engineOsc3.start();

    const intake = this.loopNoise(ctx);
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
  }

  private buildNoiseLayers(ctx: AudioContext): void {
    const screech = this.loopNoise(ctx);
    this.screechFilterA = ctx.createBiquadFilter();
    this.screechFilterA.type = 'bandpass';
    this.screechFilterA.Q.value = 7;
    this.screechFilterB = ctx.createBiquadFilter();
    this.screechFilterB.type = 'bandpass';
    this.screechFilterB.Q.value = 10;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    screech.connect(this.screechFilterA).connect(this.screechGain);
    screech.connect(this.screechFilterB).connect(this.screechGain);
    this.screechGain.connect(this.master);

    const wind = this.loopNoise(ctx);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    const road = this.loopNoise(ctx, true);
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = 'lowpass';
    roadFilter.frequency.value = 220;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    road.connect(roadFilter).connect(this.roadGain).connect(this.master);

    this.rumbleOsc = ctx.createOscillator();
    this.rumbleOsc.type = 'square';
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 380;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleOsc.connect(rumbleFilter).connect(this.rumbleGain).connect(this.master);
    this.rumbleOsc.start();

    const scrape = this.loopNoise(ctx);
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = 'bandpass';
    scrapeFilter.frequency.value = 2900;
    scrapeFilter.Q.value = 3;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    scrape.connect(scrapeFilter).connect(this.scrapeGain).connect(this.master);
  }

  private buildVoice(ctx: AudioContext): Voice {
    const noise = this.loopNoise(ctx);
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'bandpass';
    roarFilter.frequency.value = 420;
    roarFilter.Q.value = 0.9;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 80;
    osc.start();
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 320;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.35;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    noise.connect(roarFilter).connect(gain);
    osc.connect(humFilter).connect(humGain).connect(gain);
    gain.connect(pan).connect(this.master);
    return { sourceId: -1, noise, osc, roarFilter, humFilter, gain, pan, lastDistance: 0, doppler: 1 };
  }

  // -------------------------------------------------------------------- update

  update(dt: number, car: CarSoundState, listener: THREE.Camera, sources: readonly SoundSource[]): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.time += dt;
    const t = ctx.currentTime;
    const k = 0.03;

    // --- engine
    const rpm = Math.max(car.rpm, car.idleRPM * 0.9);
    const fire = rpm / 20;
    const rpmNorm = clamp01((rpm - car.idleRPM) / (car.limiterRPM - car.idleRPM));
    const load = car.limiterCutting ? 0 : clamp01(car.load);
    this.engineOsc1.frequency.setTargetAtTime(fire, t, 0.012);
    this.engineOsc2.frequency.setTargetAtTime(fire / 3, t, 0.012);
    this.engineOsc3.frequency.setTargetAtTime(fire * 2.005, t, 0.012);
    this.enginePre.gain.setTargetAtTime(0.6 + load * 1.4, t, k);
    this.engineFilter.frequency.setTargetAtTime(260 + rpm * 0.32 + load * 2200, t, k);
    const engineLevel = 0.1 + load * 0.2 + rpmNorm * 0.12;
    this.engineGain.gain.setTargetAtTime(car.limiterCutting ? engineLevel * 0.5 : engineLevel, t, car.limiterCutting ? 0.005 : k);
    this.intakeFilter.frequency.setTargetAtTime(500 + rpm * 0.45, t, k);
    this.intakeGain.gain.setTargetAtTime(load * (0.02 + rpmNorm * 0.07), t, k);

    // Crackle and pops after lifting off at high rpm.
    if (this.lastThrottle > 0.6 && car.throttle < 0.1 && this.lastRpm > 4200) {
      this.popsUntil = this.time + 0.9;
      this.nextPop = this.time + 0.05;
    }
    if (this.time < this.popsUntil && this.time >= this.nextPop && car.throttle < 0.1) {
      this.playPop(0.4 + Math.random() * 0.6);
      this.nextPop = this.time + 0.05 + Math.random() * 0.16;
    }
    this.lastThrottle = car.throttle;
    this.lastRpm = rpm;

    // --- tires, wind, road
    const v = car.speed;
    const slipLevel = clamp01((car.slip - 0.85) * 1.1) * clamp01(v / 6);
    const wobble = 1 + Math.sin(this.time * 23) * 0.04 + Math.sin(this.time * 7.3) * 0.03;
    this.screechFilterA.frequency.setTargetAtTime((980 + car.slip * 120) * wobble, t, k);
    this.screechFilterB.frequency.setTargetAtTime((1540 + car.slip * 160) * wobble, t, k);
    this.screechGain.gain.setTargetAtTime(slipLevel * 0.55, t, 0.05);
    const speedNorm = clamp01(v / 78);
    this.windFilter.frequency.setTargetAtTime(220 + v * 16, t, k);
    this.windGain.gain.setTargetAtTime(speedNorm * speedNorm * 0.32 * (1 + Math.sin(this.time * 0.9) * 0.12), t, 0.1);
    this.roadGain.gain.setTargetAtTime(clamp01(v / 40) * 0.2 + speedNorm * 0.12, t, 0.1);
    this.rumbleOsc.frequency.setTargetAtTime(Math.max(20, v / 0.3), t, k);
    this.rumbleGain.gain.setTargetAtTime(car.onRumbleStrip && v > 3 ? 0.16 : 0, t, 0.02);
    this.scrapeGain.gain.setTargetAtTime(car.scrapeAge < 0.12 && v > 3 ? clamp01(v / 30) * 0.3 : 0, t, 0.03);

    this.updateVoices(dt, listener, sources, t);
  }

  private updateVoices(dt: number, listener: THREE.Camera, sources: readonly SoundSource[], t: number): void {
    const lp = listener.position;
    // Pick the four nearest sources; keep existing assignments stable to avoid clicks.
    const nearest = [...sources]
      .map((s) => ({ s, dist: s.position.distanceTo(lp) }))
      .filter((e) => e.dist < 160)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, this.voices.length);
    const wanted = new Set(nearest.map((e) => e.s.id));
    for (const voice of this.voices) if (!wanted.has(voice.sourceId)) voice.sourceId = -1;
    for (const e of nearest) {
      if (this.voices.some((v) => v.sourceId === e.s.id)) continue;
      const free = this.voices.find((v) => v.sourceId === -1);
      if (!free) break;
      free.sourceId = e.s.id;
      free.lastDistance = e.dist;
      free.doppler = 1;
    }
    listener.updateMatrixWorld();
    const right = tmpVec.set(1, 0, 0).applyQuaternion(listener.quaternion);
    for (const voice of this.voices) {
      const entry = nearest.find((e) => e.s.id === voice.sourceId);
      if (!entry) {
        voice.gain.gain.setTargetAtTime(0, t, 0.08);
        continue;
      }
      const src = entry.s;
      const dist = entry.dist;
      // Radial velocity from the change in distance → doppler factor.
      const radial = dt > 0 ? (dist - voice.lastDistance) / dt : 0;
      voice.lastDistance = dist;
      const target = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + clamp(radial, -120, 120)), 0.6, 1.6);
      voice.doppler += (target - voice.doppler) * Math.min(1, dt * 8);
      const d = voice.doppler;
      voice.osc.frequency.setTargetAtTime(src.hum * (0.8 + src.speed / 80) * d, t, 0.03);
      voice.roarFilter.frequency.setTargetAtTime((300 + src.speed * 6) * d, t, 0.03);
      voice.noise.playbackRate.setTargetAtTime(d, t, 0.03);
      const level = (src.loudness * (0.15 + clamp01(src.speed / 35))) / (1 + (dist / 9) * (dist / 9));
      voice.gain.gain.setTargetAtTime(Math.min(0.5, level * 0.9), t, 0.05);
      const dir = tmpVec.copy(src.position).sub(lp);
      const pan = dist > 0.1 ? clamp(dir.dot(right) / dist, -1, 1) : 0;
      voice.pan.pan.setTargetAtTime(pan * 0.85, t, 0.05);
    }
  }

  // ------------------------------------------------------------------ one-shots

  private burst(duration: number, filterType: BiquadFilterType, freq: number, q: number, level: number, when = 0, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(filter).connect(g).connect(p).connect(this.sfx);
    src.start(t0, Math.random() * 1.5, duration + 0.05);
  }

  private tone(freq: number, endFreq: number, duration: number, type: OscillatorType, level: number, when = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private playPop(level: number): void {
    this.burst(0.05, 'bandpass', 700 + Math.random() * 900, 1.2, 0.35 * level);
    this.tone(95 + Math.random() * 30, 50, 0.07, 'sine', 0.3 * level);
  }

  playShift(up: boolean): void {
    this.burst(0.035, 'highpass', 2500, 0.7, 0.12);
    this.tone(up ? 140 : 110, 60, 0.06, 'sine', 0.18);
  }

  /** Light bump or scrape impact. */
  playImpact(intensity: number): void {
    const i = clamp01(intensity);
    this.burst(0.18 + i * 0.2, 'lowpass', 1800 + i * 1500, 0.8, 0.25 + i * 0.4);
    this.tone(120, 45, 0.18, 'sine', 0.3 * i + 0.1);
    this.tone(930 + Math.random() * 200, 700, 0.25, 'triangle', 0.05 * i);
  }

  /** Big crash: crunch, thump and metallic ringing. */
  playCrash(intensity: number): void {
    const i = clamp01(intensity);
    this.burst(0.9, 'lowpass', 3200, 0.6, 0.9 * (0.6 + i * 0.4));
    this.burst(0.5, 'bandpass', 900, 1.5, 0.5, 0.03);
    this.burst(1.3, 'lowpass', 600, 0.5, 0.35, 0.08);
    this.tone(70, 30, 0.6, 'sine', 0.9);
    for (const f of [820, 1370, 2210, 3050]) this.tone(f * (0.95 + Math.random() * 0.1), f * 0.85, 0.9 + Math.random() * 0.6, 'triangle', 0.05);
    for (let k = 0; k < 6; k++) this.burst(0.08, 'highpass', 4000, 0.7, 0.12, 0.1 + Math.random() * 0.5, Math.random() * 2 - 1);
  }

  /** Near-miss whoosh panned to the side the car passed on. */
  playWhoosh(pan: number, strength: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(350, t0);
    filter.frequency.exponentialRampToValueAtTime(1800, t0 + 0.18);
    filter.frequency.exponentialRampToValueAtTime(500, t0 + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35 * clamp01(strength), t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    src.connect(filter).connect(g).connect(p).connect(this.sfx);
    src.start(t0, Math.random(), 0.6);
  }

  /** Two-tone car horn from a traffic vehicle, attenuated by distance. */
  playHorn(distance: number, pan: number, truck: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const level = 0.22 / (1 + (distance / 14) ** 2);
    const t0 = ctx.currentTime;
    const dur = 0.45 + Math.random() * 0.3;
    const freqs = truck ? [185, 233] : [392, 494];
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + 0.02);
    g.gain.setValueAtTime(level, t0 + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.08);
    filter.connect(g).connect(p).connect(this.sfx);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(t0);
      osc.stop(t0 + dur + 0.1);
    }
  }

  playUiClick(): void {
    this.tone(880, 660, 0.06, 'sine', 0.12);
  }
}
