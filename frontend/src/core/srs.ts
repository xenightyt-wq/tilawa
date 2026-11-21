/**
 * Révision espacée : SM-2 simplifié, une carte par verset (index global).
 * La qualité (0..5) est déduite de la récitation du verset.
 */

export interface Card {
  verse: number;
  ef: number; // facteur de facilité
  interval: number; // jours
  reps: number; // répétitions réussies consécutives
  lapses: number;
  due: string; // AAAA-MM-JJ
  lastQuality: number;
  lastReview: string;
  seen: number;
}

export function today(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return today(new Date(y, m - 1, d + days));
}

/** Qualité SM-2 à partir du résultat d'un verset. */
export function qualityFrom(r: { errors: number; hints: number; words: number }): number {
  if (r.errors === 0 && r.hints === 0) return 5;
  if (r.errors === 0) return 4; // juste, mais avec indice(s)
  if (r.errors === 1 && r.words >= 6) return 3;
  if (r.errors <= 2) return 2;
  return 1;
}

export function newCard(verse: number, date = today()): Card {
  return { verse, ef: 2.5, interval: 0, reps: 0, lapses: 0, due: date, lastQuality: -1, lastReview: '', seen: 0 };
}

export function review(card: Card, quality: number, date = today()): Card {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  const c = { ...card, lastQuality: q, lastReview: date, seen: card.seen + 1 };
  if (q < 3) {
    c.reps = 0;
    c.interval = 1;
    c.lapses++;
  } else {
    c.reps++;
    c.interval = c.reps === 1 ? 1 : c.reps === 2 ? 6 : Math.round(card.interval * card.ef);
  }
  c.ef = Math.max(1.3, card.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  c.due = addDays(date, c.interval);
  return c;
}

export function isDue(card: Card, date = today()): boolean {
  return card.due <= date;
}

export type SuraStatus = 'unseen' | 'learning' | 'acquired';

/** Statut d'une sourate selon les cartes de ses versets. */
export function suraStatus(cards: (Card | undefined)[]): SuraStatus {
  const seen = cards.filter(Boolean) as Card[];
  if (!seen.length) return 'unseen';
  const acquired =
    seen.length === cards.length && seen.every((c) => c.reps >= 2 && c.lastQuality >= 4);
  return acquired ? 'acquired' : 'learning';
}
