import { useEffect, useMemo, useRef, useState } from 'react';
import type { Nav } from '../App';
import { TopBar } from '../components/TopBar';
import { verseRef } from '../core/quran';
import { suraStatus, type Card } from '../core/srs';
import { allCards, allSessions, exportAll, importAll, type SessionRecord } from '../lib/db';
import { useT, type Key } from '../lib/i18n';
import { useQuran } from '../lib/quranData';
import { rangeTitle } from './Recite';

export function Stats({ nav }: { nav: Nav }) {
  const t = useT();
  const q = useQuran();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const reload = () => {
    allSessions().then((s) => setSessions(s.reverse()));
    allCards().then(setCards);
  };
  useEffect(reload, []);

  const cardMap = useMemo(() => new Map(cards.map((c) => [c.verse, c])), [cards]);
  const recent = sessions.slice(0, 10);
  const avg = recent.length ? recent.reduce((a, s) => a + s.accuracy, 0) / recent.length : 0;

  // Versets les plus ratés : nombre de fautes cumulées dans l'historique
  const missed = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of sessions) for (const e of s.errors) m.set(e.verse, (m.get(e.verse) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [sessions]);

  const suraRows = useMemo(
    () =>
      q.suras.map((s) => {
        const cs = Array.from({ length: s.ayas }, (_, i) => cardMap.get(s.start + i));
        return { s, status: suraStatus(cs), seen: cs.filter(Boolean).length };
      }),
    [q, cardMap],
  );
  const counts = {
    learning: suraRows.filter((r) => r.status === 'learning').length,
    acquired: suraRows.filter((r) => r.status === 'acquired').length,
  };

  const doExport = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tilawa-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File) => {
    try {
      const r = await importAll(JSON.parse(await f.text()));
      setMsg(t('importOk', { s: r.sessions, c: r.cards }));
      reload();
    } catch (e) {
      setMsg(t('importFail', { e: (e as Error).message }));
    }
  };

  return (
    <div className="screen">
      <TopBar nav={nav} title={t('stats')} />
      <section className="card kpis">
        <div>
          <div className="big">{sessions.length}</div>
          <div className="muted">{t('sessions')}</div>
        </div>
        <div>
          <div className="big">{recent.length ? `${Math.round(avg * 100)}%` : '—'}</div>
          <div className="muted">{t('avgAccuracy')}</div>
        </div>
        <div>
          <div className="big">
            {counts.acquired}/{counts.learning + counts.acquired}
          </div>
          <div className="muted">{t('surasAcquired')}</div>
        </div>
      </section>

      <section className="card">
        <h2 className="h-small">{t('history')}</h2>
        {sessions.length === 0 ? (
          <p className="muted">{t('noData')}</p>
        ) : (
          <ul className="list" data-testid="history">
            {sessions.slice(0, 30).map((s) => (
              <li key={s.id}>
                <span className="muted small">{new Date(s.startedAt).toLocaleString()}</span>
                <span>
                  {t(`kind_${s.kind}` as Key)} · {rangeTitle(q, s.from, s.to)}
                </span>
                <span className={`pill ${s.accuracy >= 0.9 ? 'good' : s.accuracy >= 0.7 ? 'mid' : 'bad'}`}>
                  {Math.round(s.accuracy * 100)}% · {s.errors.length} {t('errors').toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="h-small">{t('mostMissed')}</h2>
        {missed.length === 0 ? (
          <p className="muted">{t('noData')}</p>
        ) : (
          <ul className="list">
            {missed.map(([v, n]) => {
              const r = verseRef(q, v);
              return (
                <li key={v}>
                  <span>
                    {q.suras[r.sura - 1].tname} {r.sura}:{r.aya}
                  </span>
                  <span className="ar small-ar" lang="ar" dir="rtl">
                    {q.verses[v][0].split(' ').slice(0, 6).join(' ')}…
                  </span>
                  <span className="pill bad">×{n}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="h-small">{t('progress')}</h2>
        <div className="legend">
          <span className="dot unseen" /> {t('status_unseen')} <span className="dot learning" /> {t('status_learning')}{' '}
          <span className="dot acquired" /> {t('status_acquired')}
        </div>
        <div className="sura-grid">
          {suraRows.map(({ s, status, seen }) => (
            <button
              key={s.n}
              className={`sura-cell ${status}`}
              title={`${s.n}. ${s.tname} — ${t(`status_${status}` as Key)} (${seen}/${s.ayas})`}
              aria-label={`${s.tname} : ${t(`status_${status}` as Key)}`}
              onClick={() =>
                nav.go({ name: 'recite', job: { kind: 'recite', segments: [[s.start, s.start + s.ayas - 1]], mask: 'none' } })
              }
            >
              {s.n}
            </button>
          ))}
        </div>
      </section>

      <section className="card row-actions">
        <button className="btn btn-ghost" onClick={doExport}>
          {t('export')}
        </button>
        <button className="btn btn-ghost" onClick={() => file.current?.click()}>
          {t('import')}
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])}
        />
        {msg && <p className="muted">{msg}</p>}
      </section>
    </div>
  );
}
