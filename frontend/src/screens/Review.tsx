import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { TopBar } from '../components/TopBar';
import { verseRef } from '../core/quran';
import { today, type Card } from '../core/srs';
import { dueCards } from '../lib/db';
import { useT } from '../lib/i18n';
import { useQuran } from '../lib/quranData';
import { rangeTitle } from './Recite';

/** Regroupe des versets dus en passages contigus (même sourate). */
export function groupRuns(q: ReturnType<typeof useQuran>, verses: number[]): [number, number][] {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const v of sorted) {
    const last = runs[runs.length - 1];
    if (last && v === last[1] + 1 && verseRef(q, v).sura === verseRef(q, last[1]).sura) last[1] = v;
    else runs.push([v, v]);
  }
  return runs;
}

export function Review({ nav }: { nav: Nav }) {
  const t = useT();
  const q = useQuran();
  const [cards, setCards] = useState<Card[] | null>(null);
  useEffect(() => {
    dueCards(today()).then(setCards);
  }, []);
  if (!cards) return null;
  const runs = groupRuns(
    q,
    cards.map((c) => c.verse),
  );

  return (
    <div className="screen">
      <TopBar nav={nav} title={t('review')} />
      <div className="card">
        <p className="muted">{t('reviewIntro')}</p>
        {runs.length === 0 ? (
          <p data-testid="review-empty">{t('reviewNone')}</p>
        ) : (
          <>
            <ul className="list">
              {runs.map(([a, b]) => (
                <li key={a}>
                  {rangeTitle(q, a, b)}
                  <span className="muted">
                    {' '}
                    · {b - a + 1} {t('verses')}
                  </span>
                </li>
              ))}
            </ul>
            <button
              className="btn btn-block"
              data-testid="review-start"
              onClick={() => nav.replace({ name: 'recite', job: { kind: 'review', segments: runs, mask: 'all' } })}
            >
              {t('reviewStart')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
