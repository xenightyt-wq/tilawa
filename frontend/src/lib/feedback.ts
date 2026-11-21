let ctx: AudioContext | null = null;

/** Petit signal sonore doux (deux notes descendantes). */
export function beep() {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    for (const [i, f] of [660, 440].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.13);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.14);
      o.stop(t + i * 0.14 + 0.15);
    }
  } catch {
    /* audio indisponible */
  }
}

export function vibrate() {
  navigator.vibrate?.([80, 60, 80]);
}
