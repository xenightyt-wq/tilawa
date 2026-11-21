import type { RecitationTracker } from '../core/tracker';
import { useT, type Key } from '../lib/i18n';
import { Icon } from './Icon';

export function ResultCard({
  tracker,
  actions,
  title,
}: {
  tracker: RecitationTracker;
  actions: React.ReactNode;
  title?: string;
}) {
  const t = useT();
  const s = tracker.summary();
  const pct = Math.round(s.accuracy * 100);
  return (
    <section className="result card" aria-live="polite" data-testid="result">
      <h2>
        <Icon name={tracker.errors.length ? 'flag' : 'check'} /> {title ?? t('doneTitle')}
      </h2>
      <div className="result-stats">
        <div>
          <div className={`big ${pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'bad'}`} data-testid="accuracy">
            {pct}%
          </div>
          <div className="muted">{t('accuracy')}</div>
        </div>
        <div>
          <div className="big">{tracker.errors.length}</div>
          <div className="muted">{t('errors')}</div>
        </div>
        <div>
          <div className="big">{s.hints}</div>
          <div className="muted">{t('hints')}</div>
        </div>
      </div>
      {tracker.errors.length === 0 ? (
        <p className="good">{t('noErrors')}</p>
      ) : (
        <>
          <h3>{t('errorList')}</h3>
          <ul className="err-list">
            {tracker.errors.map((e, i) => {
              const w = tracker.words[Math.min(e.wordIdx, tracker.words.length - 1)];
              return (
                <li key={i}>
                  <span className="err-type">{t(`err_${e.type}` as Key)}</span>
                  <span className="err-ref">
                    {w.sura}:{w.aya}
                  </span>
                  <span className="ar" lang="ar" dir="rtl">
                    {w.display}
                  </span>
                  {e.heard && (
                    <span className="muted ar" lang="ar" dir="rtl">
                      ({e.heard})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="row-actions">{actions}</div>
    </section>
  );
}
