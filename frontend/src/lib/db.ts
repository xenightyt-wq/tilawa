import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Card } from '../core/srs';

export type SessionKind = 'recite' | 'memorize' | 'quiz' | 'review';

export interface SessionErrorRecord {
  type: string;
  verse: number;
  word: number; // index du mot dans le verset
  heard?: string;
}

export interface SessionRecord {
  id?: number;
  kind: SessionKind;
  startedAt: number;
  endedAt: number;
  from: number;
  to: number;
  totalWords: number;
  correctWords: number;
  accuracy: number;
  hints: number;
  completed: boolean;
  errors: SessionErrorRecord[];
}

export interface LastPosition {
  from: number;
  to: number;
  kind: SessionKind;
  mask: string;
  at: number;
}

interface TilawaDB extends DBSchema {
  sessions: { key: number; value: SessionRecord; indexes: { byStart: number } };
  cards: { key: number; value: Card; indexes: { byDue: string } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<TilawaDB>> | null = null;

export function db(): Promise<IDBPDatabase<TilawaDB>> {
  dbp ??= openDB<TilawaDB>('tilawa', 1, {
    upgrade(d) {
      const s = d.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      s.createIndex('byStart', 'startedAt');
      const c = d.createObjectStore('cards', { keyPath: 'verse' });
      c.createIndex('byDue', 'due');
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

export async function addSession(s: SessionRecord): Promise<number> {
  return (await db()).add('sessions', s);
}

export async function allSessions(): Promise<SessionRecord[]> {
  return (await db()).getAllFromIndex('sessions', 'byStart');
}

export async function getCard(verse: number): Promise<Card | undefined> {
  return (await db()).get('cards', verse);
}

export async function putCards(cards: Card[]): Promise<void> {
  const tx = (await db()).transaction('cards', 'readwrite');
  await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
}

export async function allCards(): Promise<Card[]> {
  return (await db()).getAll('cards');
}

export async function dueCards(date: string): Promise<Card[]> {
  return (await db()).getAllFromIndex('cards', 'byDue', IDBKeyRange.upperBound(date));
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

/** Export complet des données locales (JSON). */
export async function exportAll() {
  return {
    app: 'tilawa',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: await allSessions(),
    cards: await allCards(),
    settings: await kvGet('settings'),
    last: await kvGet('last'),
  };
}

export async function importAll(data: unknown): Promise<{ sessions: number; cards: number }> {
  const d = data as Awaited<ReturnType<typeof exportAll>>;
  if (!d || d.app !== 'tilawa' || !Array.isArray(d.sessions) || !Array.isArray(d.cards)) {
    throw new Error('Fichier invalide');
  }
  const conn = await db();
  const tx = conn.transaction(['sessions', 'cards', 'kv'], 'readwrite');
  await tx.objectStore('sessions').clear();
  await tx.objectStore('cards').clear();
  for (const s of d.sessions) await tx.objectStore('sessions').put(s);
  for (const c of d.cards) await tx.objectStore('cards').put(c);
  if (d.settings) await tx.objectStore('kv').put(d.settings, 'settings');
  if (d.last) await tx.objectStore('kv').put(d.last, 'last');
  await tx.done;
  return { sessions: d.sessions.length, cards: d.cards.length };
}
