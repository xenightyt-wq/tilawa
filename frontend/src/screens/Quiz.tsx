import { useMemo, useRef, useState } from 'react';
import type { Nav } from '../App';
import { Icon } from '../components/Icon';
import { RecitationPanel } from '../components/RecitationPanel';
import { ResultCard } from '../components/ResultCard';
import { TopBar } from '../components/TopBar';
import { DEFAULT_ZONE, ZonePicker, zoneRange, type Zone } from '../components/ZonePicker';
import { buildPassage, displayTokens, sliceWords, toArabicDigits, verseRef, type QuranData } from '../core/quran';
import type { RecitationTracker } from '../core/tracker';
import { useT, type Key } from '../lib/i18n';
import { saveSession } from '../lib/progress';
import { useQuran } from '../lib/quranData';
import { useSettings } from '../lib/settings';

type QType = 'next' | 'prev' | 'complete';
type QChoice = QType | 'mixed';

interface Question {
  type: QType;
  /** verset montré */
  shown: number;
  /** pour "complete" : nombre de mots montrés */
  shownWords?: number;
  /** verset à réciter */
  target: number;
}

export function makeQuestion(q: QuranData, from: number, to: number, choice: QChoice, rnd = Math.random): Question | null {
  const types: QType[] = choice === 'mixed' ? ['next', 'prev', 'complete'] : [choice];
  for (let attempt = 0; attempt < 50; attempt++) {
    const type = types[Math.floor(rnd() * types.length)];
    const v = from + Math.floor(rnd() * (to - from + 1));
    const r = verseRef(q, v);
    const ayas = q.suras[r.sura - 1].ayas;
    if (type === 'next' && v < to && r.aya < ayas) return { type, shown: v, target: v + 1 };
    if (type === 'prev' && v > from && r.aya > 1) return { type, shown: v, target: v - 1 };
    if (type === 'complete') {
      const n = displayTokens(q.verses[v][0]).length;
      if (n >= 4) return { type, shown: v, target: v, shownWords: Math.max(1, Math.round(n * 0.4)) };
    }
  }
  // Zone d'un seul verset : on demande de le compléter
  const n = displayTokens(q.verses[from][0]).length;
  return n >= 2 ? { type: 'complete', shown: from, target: from, shownWords: Math.max(1, Math.floor(n / 2)) } : null;
}

export function Quiz({ nav }: { nav: Nav }) {
  const t = useT();
  const q = useQuran();
  const { settings } = useSettings();
  const [zone, setZone] = useState<Zone>(DEFAULT_ZONE);
  const [choice, setChoice] = useState<QChoice>('mixed');
  const [question, setQuestion] = useState<Question | null>(null);
  const [n, setN] = useState(0);
  const [result, setResult] = useState<RecitationTracker | null>(null);
  const [reveal, setReveal] = useState(false);
  const [score, setScore] = useState({ ok: 0, total: 0 });
  const startedAt = useRef(Date.now());

  const words = useMemo(() => {
    if (!question) return [];
    const all = buildPassage(q, question.target, question.target, { optionalPrefix: false }).words;
    return question.type === 'complete' ? sliceWords(all, question.shownWords!) : all;
  }, [q, question]);

  const next = () => {
    const [from, to] = zoneRange(q, zone);
    setQuestion(makeQuestion(q, from, to, choice));
    setResult(null);
    setReveal(false);
    setN((x) => x + 1);
    startedAt.current = Date.now();
  };

  if (!question) {
    return (
      <div className="screen">
        <TopBar nav={nav} title={t('quiz')} />
        <div className="form card">
          <h2 className="h-small">{t('quizZone')}</h2>
          <ZonePicker value={zone} onChange={setZone} />
          <label className="field">
            <span>{t('quizType')}</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value as QChoice)}>
              {(['mixed', 'next', 'prev', 'complete'] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`q_${c}` as Key)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-block" onClick={next} data-testid="quiz-start">
            {t('start')}
          </button>
        </div>
      </div>
    );
  }

  const shown = verseRef(q, question.shown);
  const shownText =
    question.type === 'complete'
      ? displayTokens(q.verses[question.shown][0]).slice(0, question.shownWords).join(' ') + ' …'
      : q.verses[question.shown][0];

  return (
    <div className="screen screen-recite">
      <TopBar
        nav={nav}
        title={t('quiz')}
        sub={`${t('score')} : ${score.ok} / ${score.total}`}
      />
      <section className="prompt card">
        <div className="muted">{t(`quizPrompt_${question.type}` as Key)}</div>
        <p className="prompt-ar" lang="ar" dir="rtl" style={{ fontSize: Math.round(settings.fontSize * 0.8) }}>
          {shownText}
          {question.type !== 'complete' && <span className="ayah-num">{'﴿' + toArabicDigits(shown.aya) + '﴾'}</span>}
        </p>
        <div className="muted small">
          {q.suras[shown.sura - 1].tname} {shown.sura}:{shown.aya}
        </div>
      </section>
      {result ? (
        <>
          <ResultCard
            tracker={result}
            actions={
              <>
                <button className="btn btn-ghost" onClick={() => setReveal(!reveal)}>
                  {t('quizReveal')}
                </button>
                <button className="btn" onClick={next} data-testid="quiz-next">
                  {t('quizNew')} <Icon name="continue" />
                </button>
              </>
            }
          />
          {reveal && (
            <p className="prompt-ar card" lang="ar" dir="rtl" style={{ fontSize: Math.round(settings.fontSize * 0.8) }}>
              {words.map((w) => w.display).join(' ')}
            </p>
          )}
        </>
      ) : (
        <RecitationPanel
          key={n}
          words={words}
          mask="all"
          allowHint
          onComplete={(tr) => {
            setResult(tr);
            const ok = tr.errors.length === 0 && tr.summary().hints === 0 && tr.finished;
            setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), total: s.total + 1 }));
            void saveSession(tr, 'quiz', { from: question.target, to: question.target }, startedAt.current);
          }}
        />
      )}
    </div>
  );
}
