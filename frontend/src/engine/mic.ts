import type { EngineErrorCode } from './types';

export class MicError extends Error {
  constructor(public code: EngineErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

export interface MicCapture {
  stop(): void;
}

/** Ouvre le micro et livre des blocs PCM 16 kHz / 16 bits (~100 ms). */
export async function openMic(
  onPcm: (pcm: ArrayBuffer, peak: number) => void,
): Promise<MicCapture> {
  if (!window.isSecureContext) throw new MicError('insecure-context');
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('mic-unavailable');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('mic-denied');
    throw new MicError('mic-unavailable', String(e));
  }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('/pcm-worklet.js');
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  node.port.onmessage = (ev: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) =>
    onPcm(ev.data.pcm, ev.data.peak);
  src.connect(node);
  // Pas de connexion vers ctx.destination : rien n'est rejoué.
  return {
    stop() {
      node.port.onmessage = null;
      src.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
