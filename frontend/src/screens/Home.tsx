import { useEffect, useState } from 'react';
import type { Nav } from '../App';
import { Icon } from '../components/Icon';
import { today } from '../core/srs';
import { dueCards, kvGet, type LastPosition } from '../lib/db';
import { useT } from '../lib/i18n';
import { useQuran } from '../lib/quranData';
import { rangeTitle } from './Recite';

export function Home({ nav }: { nav: Nav }) {
  const t = useT();
  const q = useQuran();
  const [last, setLast] = useState<LastPosition | null>(null);
  const [due, setDue] = useState(0);
  useEffect(() => {
    kvGet<LastPosition>('last').then((l) => setLast(l ?? null));
    dueCards(today()).then((c) => setDue(c.length));
  }, []);

  const tile = (icon: string, title: string, sub: string, onClick: () => void, opts: { primary?: boolean; testid?: string; disabled?: boolean } = {}) => (
    <button
      className={'tile' + (opts.primary ? ' tile-primary' : '')}
      onClick={onClick}
      disabled={opts.disabled}
      data-testid={opts.testid}
    >
      <span className="tile-icon">
        <Icon name={icon} size={26} />
      </span>
      <span className="tile-text">
        <span className="tile-title">{title}</span>
        <span className="tile-sub">{sub}</span>
      </span>
    </button>
  );

  return (
    <div className="screen home">
      <header className="home-head">
        <div className="brand">
          <img src="/icons/icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>{t('appName')}</h1>
            <p className="muted">{t('tagline')}</p>
          </div>
        </div>
        <div className="home-actions">
          <button className="icon-btn" onClick={() => nav.go({ name: 'settings' })} aria-label={t('settings')}>
            <Icon name="gear" />
          </button>
          <button className="icon-btn" onClick={() => nav.go({ name: 'about' })} aria-label={t('about')}>
            <Icon name="info" />
          </button>
        </div>
      </header>

      <nav className="tiles">
        {last &&
          tile('continue', t('continue'), rangeTitle(q, last.from, last.to), () =>
            nav.go({ name: 'recite', job: { kind: last.kind, segments: [[last.from, last.to]], mask: last.mask as never } }),
          { primary: true, testid: 'continue' },
          )}
        {tile('book', t('newRecitation'), t('newRecitationSub'), () => nav.go({ name: 'select' }), {
          primary: !last,
          testid: 'new-recitation',
        })}
        {tile('question', t('quiz'), t('quizSub'), () => nav.go({ name: 'quiz' }), { testid: 'quiz' })}
        {tile('calendar', t('review'), due ? t('reviewSub', { n: due }) : t('reviewNone'), () => nav.go({ name: 'review' }), {
          testid: 'review',
        })}
        {tile('chart', t('stats'), t('statsSub'), () => nav.go({ name: 'stats' }), { testid: 'stats' })}
      </nav>

      <section className="demo">
        <span className="muted">{t('demo')} :</span>
        <button
          className="chip"
          data-testid="demo-fatiha"
          onClick={() => nav.go({ name: 'recite', job: { kind: 'recite', segments: [[0, 6]], mask: 'none' } })}
        >
          {t('demoFatiha')}
        </button>
        <button
          className="chip"
          data-testid="demo-ikhlas"
          onClick={() => {
            const s = q.suras[111];
            nav.go({ name: 'recite', job: { kind: 'recite', segments: [[s.start, s.start + s.ayas - 1]], mask: 'none' } });
          }}
        >
          {t('demoIkhlas')}
        </button>
      </section>

      <p className="disclaimer">
        <Icon name="info" size={16} /> {t('disclaimer')}
      </p>
    </div>
  );
}
