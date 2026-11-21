import { createContext, useContext } from 'react';
import type { QuranData } from '../core/quran';

let cache: Promise<QuranData> | null = null;

/** Texte Tanzil embarqué (précaché par le service worker → hors ligne). */
export function loadQuran(): Promise<QuranData> {
  cache ??= fetch('/data/quran.json').then((r) => {
    if (!r.ok) throw new Error(`quran.json: HTTP ${r.status}`);
    return r.json() as Promise<QuranData>;
  });
  return cache;
}

export const QuranContext = createContext<QuranData | null>(null);

export function useQuran(): QuranData {
  const q = useContext(QuranContext);
  if (!q) throw new Error('Données du Coran non chargées');
  return q;
}
