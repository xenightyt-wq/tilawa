import { memo, useEffect, useRef } from 'react';
import { toArabicDigits, type ExpectedWord } from '../core/quran';
import type { WordState } from '../core/tracker';
import type { MaskLevel } from '../lib/settings';
import { tajweedSpans } from '../lib/tajweed';

interface Props {
  words: readonly ExpectedWord[];
  states: readonly WordState[];
  pos: number;
  mask: MaskLevel;
  fontSize: number;
  tajweed: boolean;
  /** index de verset en cours de lecture audio (surlignage) */
  playingVerse?: number | null;
  /** mot fautif en attente (mode stop) */
  errorWord?: number | null;
  onWordTap?: (w: ExpectedWord) => void;
  suraTitle?: (sura: number) => string;
  version: number;
}

const REVEALED: WordState[] = ['correct', 'corrected', 'error', 'hinted', 'skipped', 'optional'];

export function isMasked(w: ExpectedWord, mask: MaskLevel): boolean {
  if (w.optional) return false;
  switch (mask) {
    case 'all':
      return true;
    case 'first-word':
      return w.wordInAya > 0;
    case 'alternate':
      return w.wordInAya % 2 === 1;
    case 'ayah-start':
      return w.wordInAya >= 3;
    default:
      return false;
  }
}

function Word({ w, state, hidden, tajweed, isCurrent, isError, onTap }: {
  w: ExpectedWord;
  state: WordState;
  hidden: boolean;
  tajweed: boolean;
  isCurrent: boolean;
  isError: boolean;
  onTap?: (w: ExpectedWord) => void;
}) {
  const cls = [
    'w',
    `w-${state}`,
    hidden && 'w-hidden',
    isCurrent && 'w-current',
    isError && 'w-pending-error',
  ]
    .filter(Boolean)
    .join(' ');
  const content =
    tajweed && !hidden
      ? tajweedSpans(w.display).map((s, i) =>
          s.cls ? (
            <span key={i} className={`tj-${s.cls}`}>
              {s.text}
            </span>
          ) : (
            s.text
          ),
        )
      : w.display;
  return (
    <span
      className={cls}
      data-idx={w.idx}
      data-state={state}
      aria-hidden={hidden || undefined}
      onClick={onTap ? () => onTap(w) : undefined}
    >
      {content}
    </span>
  );
}

export const MushafView = memo(function MushafView(p: Props) {
  const box = useRef<HTMLDivElement>(null);

  // Défilement automatique : garde le mot courant au centre de l'écran.
  useEffect(() => {
    const target = Math.min(p.errorWord ?? p.pos, p.words.length - 1);
    const el = box.current?.querySelector<HTMLElement>(`[data-idx="${target}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [p.pos, p.errorWord, p.version, p.words.length]);

  const blocks: React.ReactNode[] = [];
  let line: React.ReactNode[] = [];
  let basmala: React.ReactNode[] = [];
  const flushLine = () => {
    if (line.length) blocks.push(<p key={`l${blocks.length}`} className="ayat">{line}</p>);
    line = [];
  };

  p.words.forEach((w, i) => {
    if (w.optional === 'istiadha') return; // récitable, jamais affichée
    const st = p.states[w.idx];
    const node = (
      <Word
        key={w.idx}
        w={w}
        state={st}
        hidden={isMasked(w, p.mask) && !REVEALED.includes(st)}
        tajweed={p.tajweed}
        isCurrent={w.idx === p.pos}
        isError={w.idx === p.errorWord}
        onTap={p.onWordTap}
      />
    );
    if (w.optional === 'basmala') {
      basmala.push(node, ' ');
      if (w.ayaEnd) {
        flushLine();
        const title = p.suraTitle && i > 0 && p.words.some((x, k) => k < i && !x.optional);
        blocks.push(
          <div key={`b${w.idx}`} className="sura-head">
            {title && <div className="sura-title">{p.suraTitle!(w.sura)}</div>}
            <p className="basmala">{basmala}</p>
          </div>,
        );
        basmala = [];
      }
      return;
    }
    // Nouvelle sourate sans basmala (at-Tawba) au milieu du passage
    if (w.aya === 1 && w.wordInAya === 0 && w.sura === 9 && i > 0 && p.suraTitle) {
      flushLine();
      blocks.push(
        <div key={`t${w.idx}`} className="sura-head">
          <div className="sura-title">{p.suraTitle(w.sura)}</div>
        </div>,
      );
    }
    line.push(node, ' ');
    if (w.ayaEnd) {
      line.push(
        <span
          key={`a${w.verse}`}
          className={'ayah-num' + (p.playingVerse === w.verse ? ' playing' : '')}
          aria-label={`verset ${w.aya}`}
        >
          {'﴿' + toArabicDigits(w.aya) + '﴾'}
        </span>,
      );
      line.push(' ');
    }
  });
  flushLine();

  return (
    <div className="mushaf" ref={box} dir="rtl" lang="ar" style={{ fontSize: p.fontSize }}>
      {blocks}
    </div>
  );
});
