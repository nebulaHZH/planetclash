/** Tiny Web Audio synth — no files, no CDN. */
export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.4
      this.master.connect(this.ctx.destination)
      const length = Math.floor(this.ctx.sampleRate * 0.8)
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.noise = buffer
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private tone(freq: number, end: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number } = {}) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime + (opts.delay ?? 0)
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = opts.type ?? 'triangle'
    osc.frequency.setValueAtTime(Math.max(1, freq), t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t + dur)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain ?? 0.1), t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private hiss(dur: number, opts: { gain?: number; cutoff?: number; type?: BiquadFilterType; delay?: number; q?: number } = {}) {
    if (!this.ctx || !this.master || !this.noise) return
    const t = this.ctx.currentTime + (opts.delay ?? 0)
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = opts.type ?? 'lowpass'
    filter.frequency.setValueAtTime(opts.cutoff ?? 1200, t)
    filter.Q.value = opts.q ?? 0.8
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain ?? 0.1), t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  shoot(kind: 'pew' | 'brr' | 'boom') {
    if (kind === 'pew') {
      this.tone(920, 320, 0.13, { type: 'triangle', gain: 0.16 })
      this.tone(1500, 700, 0.06, { type: 'sine', gain: 0.06 })
      this.hiss(0.05, { gain: 0.05, cutoff: 3800 })
    } else if (kind === 'brr') {
      this.tone(520, 260, 0.06, { type: 'sawtooth', gain: 0.07 })
      this.hiss(0.04, { gain: 0.035, cutoff: 2600 })
    } else {
      this.tone(180, 52, 0.28, { type: 'sine', gain: 0.22 })
      this.hiss(0.24, { gain: 0.2, cutoff: 900 })
      this.tone(1200, 300, 0.1, { type: 'square', gain: 0.05 })
    }
  }

  enemyShot() {
    this.tone(640, 240, 0.14, { type: 'sine', gain: 0.07 })
    this.hiss(0.08, { gain: 0.03, cutoff: 1800 })
  }

  hit(headshot: boolean) {
    this.tone(headshot ? 1800 : 1400, headshot ? 2400 : 1800, 0.07, { type: 'sine', gain: 0.09 })
    if (headshot) this.tone(2600, 3200, 0.09, { type: 'sine', gain: 0.06, delay: 0.03 })
  }

  kill() {
    const notes = [523, 659, 784, 1046]
    notes.forEach((n, i) => this.tone(n, n, 0.16, { type: 'triangle', gain: 0.12, delay: i * 0.055 }))
    this.hiss(0.18, { gain: 0.05, cutoff: 5200, type: 'highpass' })
  }

  hurt() {
    this.tone(240, 90, 0.28, { type: 'sawtooth', gain: 0.16 })
    this.hiss(0.24, { gain: 0.12, cutoff: 700 })
  }

  reload() {
    this.hiss(0.05, { gain: 0.08, cutoff: 2600 })
    this.tone(300, 220, 0.05, { type: 'square', gain: 0.05 })
    this.hiss(0.06, { gain: 0.09, cutoff: 2200, delay: 0.24 })
    this.tone(420, 520, 0.06, { type: 'square', gain: 0.045, delay: 0.26 })
  }

  equip() {
    this.hiss(0.04, { gain: 0.06, cutoff: 3000 })
    this.tone(520, 660, 0.05, { type: 'square', gain: 0.04, delay: 0.04 })
  }

  /** Knife through the air: a bright swish with a tiny metal ring. */
  slash() {
    this.hiss(0.13, { gain: 0.09, cutoff: 5200, type: 'highpass', q: 1.2 })
    this.tone(1900, 620, 0.11, { type: 'sine', gain: 0.05 })
  }

  /** Shovel biting into candy soil. */
  dig() {
    this.hiss(0.16, { gain: 0.14, cutoff: 620 })
    this.tone(190, 70, 0.14, { type: 'sine', gain: 0.13 })
    this.tone(90, 46, 0.2, { type: 'triangle', gain: 0.09, delay: 0.02 })
    this.hiss(0.1, { gain: 0.05, cutoff: 2400, type: 'bandpass', delay: 0.06 })
  }

  /** Ladder clattering into place. */
  placeLadder() {
    for (let i = 0; i < 3; i++) {
      this.hiss(0.05, { gain: 0.07, cutoff: 1800 + i * 400, delay: i * 0.05 })
      this.tone(240 + i * 60, 180, 0.06, { type: 'square', gain: 0.05, delay: i * 0.05 })
    }
  }

  jump() {
    this.tone(320, 620, 0.13, { type: 'sine', gain: 0.09 })
  }

  land() {
    this.hiss(0.1, { gain: 0.08, cutoff: 420 })
    this.tone(140, 80, 0.1, { type: 'sine', gain: 0.07 })
  }

  empty() {
    this.hiss(0.03, { gain: 0.06, cutoff: 3600, type: 'highpass' })
  }

  capture() {
    const notes = [659, 880, 1046, 1318]
    notes.forEach((n, i) => this.tone(n, n, 0.22, { type: 'triangle', gain: 0.1, delay: i * 0.08 }))
  }

  win() {
    const notes = [523, 659, 784, 1046, 1318]
    notes.forEach((n, i) => this.tone(n, n, 0.3, { type: 'triangle', gain: 0.12, delay: i * 0.12 }))
  }

  lose() {
    const notes = [392, 330, 262, 196]
    notes.forEach((n, i) => this.tone(n, n, 0.36, { type: 'sawtooth', gain: 0.08, delay: i * 0.14 }))
  }
}
