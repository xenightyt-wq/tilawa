import { MicError, openMic, type MicCapture } from './mic';
import type { EngineHandlers, RecognitionEngine } from './types';

/** URL WebSocket par défaut : même origine que l'app (proxy Vite ou FastAPI). */
export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/asr`;
}

/**
 * Envoie l'audio du micro au backend (FastAPI + faster-whisper) et reçoit
 * des transcriptions partielles et finales.
 * Seul l'audio brut part vers le serveur ; rien n'est stocké.
 */
export class ServerEngine implements RecognitionEngine {
  readonly kind = 'server' as const;
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private h: EngineHandlers | null = null;
  private stopping = false;
  /** décalage pour garder des numéros de segment croissants entre connexions */
  private segBase = 0;
  private lastSeg = 0;

  constructor(private url: string = defaultServerUrl()) {}

  async start(h: EngineHandlers): Promise<void> {
    this.h = h;
    this.stopping = false;
    h.onStatus('connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.segBase = this.lastSeg + 1;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new MicError('server-unreachable')), 8000);
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new MicError('server-unreachable'));
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string);
        if (m.type === 'ready') {
          clearTimeout(timer);
          h.onStatus('connecting', { model: m.model, device: m.device });
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          reject(new MicError('server-error', m.message));
        }
      };
    }).catch((e) => {
      this.cleanup();
      throw e;
    });

    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data as string));
    ws.onclose = () => {
      if (!this.stopping) {
        this.h?.onError('server-unreachable');
        this.cleanup();
        this.h?.onStatus('idle');
      }
    };

    try {
      this.mic = await openMic((pcm, peak) => {
        h.onLevel?.(peak);
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
      });
    } catch (e) {
      this.cleanup();
      throw e;
    }
    h.onStatus('listening');
  }

  private onMessage(m: {
    type: string;
    segment?: number;
    text?: string;
    confidence?: number;
    speaking?: boolean;
    message?: string;
  }) {
    if (!this.h) return;
    if (m.type === 'partial' || m.type === 'final') {
      const segment = this.segBase + (m.segment ?? 0);
      this.lastSeg = Math.max(this.lastSeg, segment);
      this.h.onTranscript({
        segment,
        text: m.text ?? '',
        final: m.type === 'final',
        confidence: m.confidence,
      });
    } else if (m.type === 'vad') {
      this.h.onSpeaking?.(!!m.speaking);
    } else if (m.type === 'error') {
      this.h.onError('server-error', m.message);
    }
  }

  resetSegment(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'reset' }));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Termine proprement le segment en cours et laisse arriver le final.
      this.mic?.stop();
      this.mic = null;
      this.ws.send(JSON.stringify({ type: 'flush' }));
      await new Promise((r) => setTimeout(r, 900));
    }
    this.cleanup();
    this.h?.onStatus('idle');
  }

  private cleanup() {
    this.mic?.stop();
    this.mic = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* déjà fermé */
      }
    }
    this.ws = null;
  }
}
