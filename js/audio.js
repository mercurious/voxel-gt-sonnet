// Procedural engine / tyre / wind audio (WebAudio, no assets).
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(c.destination);
    // engine
    this.o1 = c.createOscillator(); this.o2 = c.createOscillator(); this.o3 = c.createOscillator();
    this.o1.type = 'sawtooth'; this.o2.type = 'square'; this.o3.type = 'triangle';
    this.eg1 = c.createGain(); this.eg2 = c.createGain(); this.eg3 = c.createGain();
    this.filt = c.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.Q.value = 2.5;
    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
    this.shaper.curve = curve;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    this.lfo = c.createOscillator(); this.lfoG = c.createGain(); this.lfo.frequency.value = 12; this.lfoG.gain.value = 0;
    this.lfo.connect(this.lfoG); this.lfoG.connect(this.engGain.gain);
    this.o1.connect(this.eg1); this.o2.connect(this.eg2); this.o3.connect(this.eg3);
    this.eg1.connect(this.filt); this.eg2.connect(this.filt); this.eg3.connect(this.filt);
    this.filt.connect(this.shaper); this.shaper.connect(this.engGain); this.engGain.connect(this.master);
    // noise
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = () => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; return s; };
    this.skidSrc = mkNoise(); this.skidF = c.createBiquadFilter(); this.skidF.type = 'bandpass'; this.skidF.frequency.value = 1900; this.skidF.Q.value = 3;
    this.skidG = c.createGain(); this.skidG.gain.value = 0;
    this.skidSrc.connect(this.skidF); this.skidF.connect(this.skidG); this.skidG.connect(this.master);
    this.windSrc = mkNoise(); this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.windSrc.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    [this.o1, this.o2, this.o3, this.lfo, this.skidSrc, this.windSrc].forEach((n) => n.start());
    this.setCar({ snd: 'i6', cyl: 6 });
    this.ready = true;
  }

  setCar(perf) {
    this.cyl = perf.cyl; this.snd = perf.snd;
    if (!this.ctx) return;
    const t = {
      rotary: { a: 'sawtooth', b: 'sawtooth', c: 'square', g: [0.5, 0.35, 0.15], mult: 1.5 },
      i6: { a: 'sawtooth', b: 'triangle', c: 'square', g: [0.55, 0.4, 0.12], mult: 1 },
      flat6: { a: 'sawtooth', b: 'square', c: 'triangle', g: [0.5, 0.25, 0.3], mult: 1.1 },
      v8: { a: 'square', b: 'sawtooth', c: 'triangle', g: [0.45, 0.45, 0.3], mult: 0.9 },
    }[perf.snd] || {};
    this.o1.type = t.a; this.o2.type = t.b; this.o3.type = t.c;
    this.eg1.gain.value = t.g[0]; this.eg2.gain.value = t.g[1]; this.eg3.gain.value = t.g[2];
    this.mult = t.mult;
  }

  update(rpm, throttle, speed, skid) {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    const f = (rpm / 60) * (this.cyl / 2) * (this.mult || 1);
    this.o1.frequency.setTargetAtTime(f, now, 0.02);
    this.o2.frequency.setTargetAtTime(f * 0.5, now, 0.02);
    this.o3.frequency.setTargetAtTime(f * 2, now, 0.02);
    this.filt.frequency.setTargetAtTime(500 + rpm * 0.35 + throttle * 2400, now, 0.04);
    this.engGain.gain.setTargetAtTime(0.13 + throttle * 0.12, now, 0.05);
    this.lfo.frequency.setTargetAtTime(Math.max(6, rpm / 60 * this.cyl / 4), now, 0.05);
    this.lfoG.gain.setTargetAtTime((this.snd === 'v8' ? 0.05 : 0.02) * (1 - throttle * 0.6), now, 0.1);
    this.skidG.gain.setTargetAtTime(skid * 0.22, now, 0.05);
    this.skidF.frequency.setTargetAtTime(1500 + skid * 900, now, 0.1);
    this.windG.gain.setTargetAtTime(Math.min(speed / 90, 1) * 0.22, now, 0.1);
    this.windF.frequency.setTargetAtTime(300 + speed * 6, now, 0.1);
  }

  thump(strength = 1) {
    if (!this.ready) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + strength * 300;
    const g = c.createGain(); const now = c.currentTime;
    g.gain.setValueAtTime(Math.min(0.9, 0.2 + strength * 0.08), now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(now, Math.random()); s.stop(now + 0.4);
  }

  beep(freq = 880, dur = 0.18, vol = 0.25) {
    if (!this.ready) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), now = c.currentTime;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(this.master); o.start(now); o.stop(now + dur + 0.02);
  }

  silence() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0, now, 0.05); this.skidG.gain.setTargetAtTime(0, now, 0.05); this.windG.gain.setTargetAtTime(0, now, 0.05);
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; }
}
