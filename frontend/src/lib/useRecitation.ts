import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ExpectedWord } from '../core/quran';
import { RecitationTracker, type RecitationError } from '../core/tracker';
import { ServerEngine } from '../engine/serverEngine';
import { SimulationEngine } from '../engine/simulationEngine';
import type { EngineErrorCode, EngineStatus, RecognitionEngine } from '../engine/types';
import { beep, vibrate } from './feedback';
import { useSettings } from './settings';

export interface RecitationApi {
  tracker: RecitationTracker;
  status: EngineStatus;
  engineInfo: { model?: string; device?: string } | null;
  engineError: { code: EngineErrorCode; detail?: string } | null;
  /** faute en attente de reprise (mode stop) */
  pendingError: RecitationError | null;
  finished: boolean;
  level: number;
  speaking: boolean;
  sim: SimulationEngine | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  resumeAt(idx: number): void;
  resumeAtWord(): void;
  resumeAtAyah(): void;
  hint(): void;
  version: number;
}

export function useRecitation(words: readonly ExpectedWord[], onFinish?: () => void): RecitationApi {
  const { settings } = useSettings();
  const tracker = useMemo(
    () => new RecitationTracker(words, { mode: settings.mode, strictness: settings.strictness }),
    // Le suivi est recréé uniquement si le passage change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words],
  );
  useEffect(() => {
    tracker.setOptions({ mode: settings.mode, strictness: settings.strictness });
  }, [tracker, settings.mode, settings.strictness]);

  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [engineInfo, setEngineInfo] = useState<{ model?: string; device?: string } | null>(null);
  const [engineError, setEngineError] = useState<RecitationApi['engineError']>(null);
  const [pendingError, setPendingError] = useState<RecitationError | null>(null);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const engineRef = useRef<RecognitionEngine | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const engine = useMemo<RecognitionEngine>(() => {
    void engineRef.current?.stop();
    const e =
      settings.engine === 'simulation'
        ? new SimulationEngine()
        : new ServerEngine(settings.serverUrl || undefined);
    engineRef.current = e;
    return e;
  }, [settings.engine, settings.serverUrl]);

  useEffect(() => () => void engineRef.current?.stop(), []);
  useEffect(() => {
    setPendingError(null);
    bump();
  }, [tracker]);

  const finish = useCallback(async () => {
    await engine.stop();
    onFinishRef.current?.();
  }, [engine]);

  const start = useCallback(async () => {
    setEngineError(null);
    try {
      await engine.start({
        onStatus: (s, info) => {
          setStatus(s);
          if (info) setEngineInfo(info);
        },
        onError: (code, detail) => setEngineError({ code, detail }),
        onLevel: (l) => setLevel(l),
        onSpeaking: (s) => setSpeaking(s),
        onTranscript: (e) => {
          const u = tracker.update(e);
          if (u.newErrors.length) {
            const st = settingsRef.current;
            if (st.sound) beep();
            if (st.vibrate) vibrate();
            if (u.stopped) {
              engine.resetSegment();
              setPendingError(u.newErrors[0]);
            }
          }
          bump();
          if (u.finished) void finish();
        },
      });
    } catch (e) {
      const code = (e as { code?: EngineErrorCode }).code ?? 'server-unreachable';
      setEngineError({ code, detail: (e as Error).message });
      setStatus('idle');
    }
  }, [engine, tracker, finish]);

  const stop = useCallback(async () => {
    await engine.stop();
    setLevel(0);
    setSpeaking(false);
  }, [engine]);

  const resumeAt = useCallback(
    (idx: number) => {
      tracker.resumeAt(idx);
      engine.resetSegment();
      setPendingError(null);
      bump();
    },
    [tracker, engine],
  );

  return {
    tracker,
    status,
    engineInfo,
    engineError,
    pendingError,
    finished: tracker.finished,
    level,
    speaking,
    sim: engine instanceof SimulationEngine ? engine : null,
    start,
    stop,
    resumeAt,
    resumeAtWord: () => resumeAt(pendingError?.wordIdx ?? tracker.pos),
    resumeAtAyah: () => resumeAt(tracker.ayahStart(pendingError?.wordIdx ?? tracker.pos)),
    hint: () => {
      tracker.hint();
      engine.resetSegment();
      setPendingError(null);
      bump();
      if (tracker.finished) void finish();
    },
    version,
  };
}
