import { useEffect, useState } from 'react';
import { rangeOf, verseIndex } from '../core/quran';
import { useT } from '../lib/i18n';
import { useQuran } from '../lib/quranData';

export type ZoneKind = 'sura' | 'page' | 'juz' | 'hizb';

export interface Zone {
  kind: ZoneKind;
  sura: number;
  fromAya: number;
  toAya: number;
  n: number; // page / juz / hizb
}

export const DEFAULT_ZONE: Zone = { kind: 'sura', sura: 1, fromAya: 1, toAya: 7, n: 1 };

export function zoneRange(q: ReturnType<typeof useQuran>, z: Zone): [number, number] {
  if (z.kind === 'sura') {
    const a = Math.min(z.fromAya, z.toAya);
    const b = Math.max(z.fromAya, z.toAya);
    return [verseIndex(q, z.sura, a), verseIndex(q, z.sura, b)];
  }
  return rangeOf(q, z.kind, z.n);
}

const MAX: Record<Exclude<ZoneKind, 'sura'>, number> = { page: 604, juz: 30, hizb: 60 };

export function ZonePicker({ value, onChange }: { value: Zone; onChange: (z: Zone) => void }) {
  const t = useT();
  const q = useQuran();
  const [z, setZ] = useState(value);
  useEffect(() => onChange(z), [z]); // eslint-disable-line react-hooks/exhaustive-deps
  const sura = q.suras[z.sura - 1];
  const ayaOptions = Array.from({ length: sura.ayas }, (_, i) => i + 1);

  return (
    <div className="zone">
      <div className="seg" role="tablist">
        {(['sura', 'page', 'juz', 'hizb'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={z.kind === k}
            className={z.kind === k ? 'on' : ''}
            onClick={() => setZ({ ...z, kind: k, n: 1 })}
          >
            {t(k === 'sura' ? 'bySura' : k === 'page' ? 'byPage' : k === 'juz' ? 'byJuz' : 'byHizb')}
          </button>
        ))}
      </div>

      {z.kind === 'sura' ? (
        <>
          <label className="field">
            <span>{t('sura')}</span>
            <select
              value={z.sura}
              data-testid="sura-select"
              onChange={(e) => {
                const s = Number(e.target.value);
                setZ({ ...z, sura: s, fromAya: 1, toAya: q.suras[s - 1].ayas });
              }}
            >
              {q.suras.map((s) => (
                <option key={s.n} value={s.n}>
                  {s.n}. {s.tname} — {s.name} ({s.ayas})
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('fromAya')}</span>
              <select value={z.fromAya} onChange={(e) => setZ({ ...z, fromAya: Number(e.target.value) })}>
                {ayaOptions.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('toAya')}</span>
              <select value={z.toAya} onChange={(e) => setZ({ ...z, toAya: Number(e.target.value) })}>
                {ayaOptions.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : (
        <label className="field">
          <span>{t(z.kind)}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX[z.kind]}
            value={z.n}
            onChange={(e) => setZ({ ...z, n: Math.max(1, Math.min(MAX[z.kind as keyof typeof MAX], Number(e.target.value) || 1)) })}
          />
        </label>
      )}
    </div>
  );
}
