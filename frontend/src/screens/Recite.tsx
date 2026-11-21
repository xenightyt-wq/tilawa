import { useMemo, useRef, useState } from 'react';
import type { Nav } from '../App';
import { Icon } from '../components/Icon';
import { RecitationPanel } from '../components/RecitationPanel';
import { ResultCard } from '../components/ResultCard';
import { TopBar } from '../components/TopBar';
import { buildPassage, verseRef } from '../core/quran';
import type { RecitationTracker } from '../core/tracker';
import type { SessionKind } from '../lib/db';
import { useT } from '../lib/i18n';
import { saveLast, saveSession } from '../lib/progress';
import { useQuran } from '../lib/quranData';
import { useSettings, type MaskLevel } from '../lib/settings';

export interface ReciteJob {
  kind: SessionKind;
  /** plages de versets (index globaux inclusifs) ; plusieurs pour la révision */
  segments: [number, number][];
  mask: MaskLevel;
}

export function rangeTitle(q: ReturnType<typeof useQuran>, from: number, to: number): string {
  const a = verseRef(q, from);
  const b = verseRef(q, to);
  const sa = q.suras[a.sura - 1];
  if (a.sura === b.sura) {
    const full = a.aya === 1 && b.aya === sa.ayas;
    return `${sa.tname} (${sa.name})${full ? '' : ` ${a.aya}–${b.aya}`}`;
  }
  return `${sa.tname} ${a.aya} → ${q.suras[b.sura - 1].tname} ${b.aya}`;
}

export function Recite({ nav, job }: { nav: Nav; job: ReciteJob }) {
  const t = useT();
  const q = useQuran();
  const { settings, update } = useSettings();
  const [segIdx, setSegIdx] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<RecitationTracker | null>(null);
  const startedAt = useRef(Date.now());
  const [from, to] = job.segments[segIdx];
  const words = useMemo(() => buildPassage(q, from, to).words, [q, from, to, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const memorize = job.mask !== 'none';
  const last = segIdx === job.segments.length - 1;

  const onComplete = (tr: RecitationTracker) => {
    setResult(tr);
    void saveSession(tr, job.kind, { from, to }, startedAt.current);
  };

  return (
    <div className="screen screen-recite">
      <TopBar
        nav={nav}
        title={rangeTitle(q, from, to)}
        sub={
          job.segments.length > 1
            ? t('reviewProgress', { i: segIdx + 1, n: job.segments.length })
            : t(memorize ? 'modeMemorize' : 'modeRecite')
        }
        right={
          <button
            className="chip"
            onClick={() => update({ mode: settings.mode === 'stop' ? 'end' : 'stop' })}
            title={t('correctionMode')}
            data-testid="mode-toggle"
          >
            {settings.mode === 'stop' ? t('mode_stop') : t('mode_end')}
          </button>
        }
      />
      {result ? (
        <ResultCard
          tracker={result}
          title={last && job.segments.length > 1 ? t('reviewDone') : undefined}
          actions={
            <>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setResult(null);
                  setAttempt((a) => a + 1);
                  startedAt.current = Date.now();
                }}
              >
                <Icon name="replay" /> {t('again')}
              </button>
              {!last ? (
                <button
                  className="btn"
                  onClick={() => {
                    setResult(null);
                    setSegIdx((i) => i + 1);
                    startedAt.current = Date.now();
                  }}
                >
                  {t('next')} <Icon name="continue" />
                </button>
              ) : (
                <button className="btn" onClick={nav.back}>
                  {t('home')}
                </button>
              )}
            </>
          }
        />
      ) : (
        <RecitationPanel
          key={`${segIdx}-${attempt}`}
          words={words}
          mask={job.mask}
          allowHint={memorize}
          onStart={() => void saveLast(from, to, job.kind, job.mask)}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}
