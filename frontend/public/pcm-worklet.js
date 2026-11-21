/**
 * AudioWorklet : capture le micro, rééchantillonne en 16 kHz mono et envoie
 * des blocs PCM 16 bits de ~100 ms au thread principal.
 */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0; // position fractionnaire dans le flux source
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(1600);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      // Filtre passe-bas simple (moyenne) + décimation.
      this.sum += ch[i];
      this.count++;
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const v = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        const s = Math.max(-1, Math.min(1, v));
        const a = Math.abs(s);
        if (a > this.peak) this.peak = a;
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.out.length) {
          this.port.postMessage({ pcm: this.out.buffer, peak: this.peak }, [this.out.buffer]);
          this.out = new Int16Array(1600);
          this.n = 0;
          this.peak = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
