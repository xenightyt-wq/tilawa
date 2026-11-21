import { useEffect, useMemo, useRef, useState } from 'react';
import { verseRef, type ExpectedWord } from '../core/quran';
import type { RecitationTracker } from '../core/tracker';
import { AyahPlayer } from '../lib/audio';
import { useT, type Key } from '../lib/i18n';
import { useQuran } from '../lib/quranData';
import { useSettings, type MaskLevel } from '../lib/settings';
import { useRecitation } from '../lib/useRecitation';
import { Icon } from './Icon';
import { MushafView } from './MushafView';

interface Props {
  words: readonly ExpectedWord[];
  mask: MaskLevel;
  /** appelé quand le passage est terminé (ou arrêté par "Terminer") */
  onComplete: (tracker: RecitationTracker, completed: boolean) => void;
  onStart?: () => void;
  allowHint?: boolean;
}

export function RecitationPanel({ words, mask, onComplete, onStart, allowHint }: Props) {
  const t = useT();
  const q = useQuran();
  const { settings } = useSettings();
  const [done, setDone] = useState(false);
  const api = useRecitation(words, () => {
    setDone(true);
    onComplete(api.tracker, true);
  });
  const { tracker, status, pendingError } = api;
  const [playing, setPlaying] = useState<{ sura: number; aya: number } | null>(null);
  const [loop, setLoop] = useState(false);
  const player = useMemo(() => new AyahPlayer(settings.reciter), [settings.reciter]);
  useEffect(() => {
    player.onChange = setPlaying;
    return () => player.stop();
  }, [player]);

  const listening = status === 'listening' || status === 'connecting';
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  useEffect(() => {
    if (status === 'listening') onStartRef.current?.();
  }, [status]);
  const curWord = words[Math.min(pendingError?.wordIdx ?? tracker.pos, words.length - 1)];
  const curVerse = curWord && curWord.verse >= 0 ? curWord.verse : words.find((w) => w.verse >= 0)?.verse ?? 0;

  const toggleMic = async () => {
    if (listening) await api.stop();
    else {
      player.stop();
      await api.start();
    }
  };

  const listenVerse = (verse: number) => {
    if (playing) return player.stop();
    const r = verseRef(q, verse);
    void player.play([r], loop).catch(() => setPlaying(null));
  };

  const finishNow = async () => {
    await api.stop();
    setDone(true);
    onComplete(tracker, false);
  };

  const errWord = pendingError ? words[Math.min(pendingError.wordIdx, words.length - 1)] : null;

  return (
    <div className="recite">
      <MushafView
        words={words}
        states={tracker.states}
        pos={tracker.pos}
        mask={mask}
        fontSize={settings.fontSize}
        tajweed={settings.tajweed}
        playingVerse={playing ? q.suras[playing.sura - 1].start + playing.aya - 1 : null}
        errorWord={pendingError?.wordIdx ?? null}
        suraTitle={(s) => `سورة ${q.suras[s - 1].name}`}
        onWordTap={(w) => {
          if (!done && (!listening || pendingError)) {
            api.resumeAt(w.idx);
          }
        }}
        version={api.version}
      />

      {api.download && api.download.total > 0 && (
        <div className="banner banner-warn" role="status" data-testid="model-download">
          <span>
            {t('modelDownloading', {
              loaded: Math.round(api.download.loaded / 1e6),
              total: Math.round(api.download.total / 1e6),
            })}
          </span>
        </div>
      )}

      {api.engineError && (
        <div className="banner banner-warn" role="alert">
          <Icon name="alert" />
          <span>{t(`err_${api.engineError.code}` as Key, { detail: api.engineError.detail ?? '' })}</span>
        </div>
      )}

      {pendingError && errWord && (
        <div className="banner banner-error" role="alert" aria-live="assertive">
          <div className="err-head">
            <Icon name="x" />
            <strong>{t(`err_${pendingError.type}` as Key)}</strong>
            <span className="err-ref">
              {errWord.sura}:{errWord.aya}
            </span>
          </div>
          <div className="err-body">
            <span className="label">{t('expected')}</span>
            <span className="ar expected" lang="ar" dir="rtl">
              {errWord.display}
            </span>
            {pendingError.heard && (
              <>
                <span className="label">{t('heard')}</span>
                <span className="ar heard" lang="ar" dir="rtl">
                  {pendingError.heard}
                </span>
              </>
            )}
          </div>
          <div className="err-actions">
            <button className="btn" onClick={api.resumeAtWord}>
              {t('resumeWord')}
            </button>
            <button className="btn" onClick={api.resumeAtAyah}>
              {t('resumeAyah')}
            </button>
            <button className="btn btn-ghost" onClick={() => listenVerse(curVerse)}>
              <Icon name="play" size={18} /> {t('listen')}
            </button>
          </div>
        </div>
      )}

      {api.sim && !done && <SimBar api={api} words={words} />}

      {!done && (
        <div className="controls" role="toolbar">
          <div className="controls-side">
            <button
              className={'icon-btn labeled' + (playing ? ' active' : '')}
              onClick={() => listenVerse(curVerse)}
              aria-label={playing ? t('stopAudio') : t('listen')}
            >
              <Icon name={playing ? 'stop' : 'play'} />
              <span>{t('listen')}</span>
            </button>
            <button
              className={'icon-btn labeled' + (loop ? ' active' : '')}
              onClick={() => {
                setLoop(!loop);
                player.loop = !loop;
              }}
              aria-pressed={loop}
              aria-label={t('loop')}
            >
              <Icon name="loop" />
              <span>{t('loop')}</span>
            </button>
          </div>
          <button
            className={`mic ${listening ? 'mic-on' : ''} ${api.speaking ? 'mic-speaking' : ''}`}
            onClick={toggleMic}
            aria-label={listening ? t('micStop') : t('micStart')}
            aria-pressed={listening}
            style={{ ['--lvl' as string]: Math.min(1, api.level * 3).toFixed(2) }}
          >
            <Icon name={listening ? 'stop' : 'mic'} size={34} />
          </button>
          <div className="controls-side">
            {allowHint && (
              <button className="icon-btn labeled" onClick={api.hint} aria-label={t('hint')}>
                <Icon name="hint" />
                <span>{t('hint')}</span>
              </button>
            )}
            <button className="icon-btn labeled" onClick={finishNow} aria-label={t('finish')}>
              <Icon name="flag" />
              <span>{t('finish')}</span>
            </button>
          </div>
        </div>
      )}
      {!done && (
        <div className="status-line" aria-live="polite">
          {status === 'connecting'
            ? t(settings.engine === 'device' ? 'modelLoading' : 'connecting')
            : status === 'listening'
              ? t('listening')
              : t('tapMic')}
          {api.engineInfo?.model && status !== 'idle' && (
            <span className="muted" data-testid="engine-diag">
              {' '}
              · {api.engineInfo.device ?? api.engineInfo.model}
              {api.latency !== null && ` · ${api.latency} ms`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SimBar({ api, words }: { api: ReturnType<typeof useRecitation>; words: readonly ExpectedWord[] }) {
  const t = useT();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const fillExpected = () => {
    const tr = api.tracker;
    const out: string[] = [];
    for (let i = tr.pos; i < words.length; i++) {
      if (words[i].optional) continue;
      out.push(words[i].display);
      if (words[i].ayaEnd) break;
    }
    setText(out.join(' ').replace(/[ۖ-ۜ۞۩]/g, '').replace(/\s+/g, ' '));
    input.current?.focus();
  };
  return (
    <form
      className="simbar"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!api.sim?.active) await api.start();
        api.sim?.say(text);
        setText('');
      }}
    >
      <input
        ref={input}
        dir="rtl"
        lang="ar"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('simulatePlaceholder')}
        aria-label={t('simulate')}
        data-testid="sim-input"
      />
      <button type="button" className="btn btn-ghost" onClick={fillExpected} data-testid="sim-fill">
        {t('simulateNext')}
      </button>
      <button type="submit" className="btn" data-testid="sim-send">
        {t('simulateSend')}
      </button>
    </form>
  );
}
