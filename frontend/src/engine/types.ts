import type { AsrEvent } from '../core/tracker';

export type EngineStatus = 'idle' | 'connecting' | 'listening' | 'error';

export type EngineErrorCode =
  | 'mic-denied'
  | 'mic-unavailable'
  | 'insecure-context'
  | 'server-unreachable'
  | 'server-error';

export interface EngineHandlers {
  onTranscript(e: AsrEvent): void;
  onStatus(s: EngineStatus, info?: { model?: string; device?: string }): void;
  onError(code: EngineErrorCode, detail?: string): void;
  /** niveau d'entrée 0..1 (indicateur visuel) */
  onLevel?(level: number): void;
  /** la VAD détecte de la parole */
  onSpeaking?(speaking: boolean): void;
}

/**
 * Moteur de reconnaissance : interchangeable (serveur WebSocket, simulation,
 * plus tard modèle embarqué dans le navigateur). La logique de correction
 * (alignement, fautes) ne dépend que des événements `onTranscript`.
 */
export interface RecognitionEngine {
  readonly kind: 'server' | 'simulation';
  start(h: EngineHandlers): Promise<void>;
  stop(): Promise<void>;
  /** abandonne le segment en cours (après une faute en mode "stop") */
  resetSegment(): void;
}
