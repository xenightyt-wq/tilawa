import type { EngineHandlers, RecognitionEngine } from './types';

/**
 * Moteur de simulation (démo sans micro ni serveur, tests de bout en bout) :
 * le texte saisi est "récité" mot par mot, comme le ferait le serveur
 * (partiels toutes les 250 ms, puis un final).
 */
export class SimulationEngine implements RecognitionEngine {
  readonly kind = 'simulation' as const;
  private h: EngineHandlers | null = null;
  private segment = 0;
  private timers: number[] = [];
  private running = false;

  async start(h: EngineHandlers): Promise<void> {
    this.h = h;
    this.running = true;
    h.onStatus('listening', { model: 'simulation', device: 'navigateur' });
  }

  async stop(): Promise<void> {
    this.clear();
    this.running = false;
    this.h?.onStatus('idle');
  }

  resetSegment(): void {
    this.clear();
    this.segment++;
  }

  get active(): boolean {
    return this.running;
  }

  /** Simule la récitation d'un texte (un segment, puis une pause). */
  say(text: string, wordMs = 250): void {
    if (!this.h || !this.running) return;
    const words = text.trim().split(/\s+/).filter(Boolean);
    const seg = ++this.segment;
    const h = this.h;
    h.onSpeaking?.(true);
    words.forEach((_, i) => {
      this.timers.push(
        window.setTimeout(() => {
          if (seg !== this.segment) return;
          h.onTranscript({ segment: seg, text: words.slice(0, i + 1).join(' '), final: false });
        }, (i + 1) * wordMs),
      );
    });
    this.timers.push(
      window.setTimeout(() => {
        if (seg !== this.segment) return;
        h.onSpeaking?.(false);
        h.onTranscript({ segment: seg, text: words.join(' '), final: true, confidence: -0.1 });
      }, (words.length + 1) * wordMs + 300),
    );
  }

  private clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}
