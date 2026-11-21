import { createContext, useContext } from 'react';
import type { CorrectionMode, Strictness } from '../core/tracker';
import type { Lang } from './i18n';

export type Theme = 'auto' | 'light' | 'dark';
export type MaskLevel = 'none' | 'all' | 'first-word' | 'alternate' | 'ayah-start';
export type EngineKind = 'server' | 'simulation';

export interface Settings {
  lang: Lang;
  theme: Theme;
  fontSize: number; // px
  tajweed: boolean;
  mode: CorrectionMode;
  strictness: Strictness;
  sound: boolean;
  vibrate: boolean;
  reciter: string;
  engine: EngineKind;
  serverUrl: string; // vide = même origine
  mask: MaskLevel;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'fr',
  theme: 'auto',
  fontSize: 30,
  tajweed: false,
  mode: 'stop',
  strictness: 'strict',
  sound: true,
  vibrate: true,
  reciter: 'Husary_128kbps',
  engine: 'server',
  serverUrl: '',
  mask: 'all',
};

export const RECITERS: { id: string; name: string }[] = [
  { id: 'Husary_128kbps', name: 'Mahmoud Khalil Al-Husary' },
  { id: 'Husary_Muallim_128kbps', name: 'Al-Husary (Mu‘allim, lent)' },
  { id: 'Minshawy_Murattal_128kbps', name: 'Mohamed Siddiq Al-Minshawi' },
  { id: 'Alafasy_128kbps', name: 'Mishary Rashid Alafasy' },
  { id: 'Abdul_Basit_Murattal_192kbps', name: 'Abdul Basit (Murattal)' },
  { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'Abdurrahman As-Sudais' },
];

export const SettingsContext = createContext<{
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}>({ settings: DEFAULT_SETTINGS, update: () => {} });

export const useSettings = () => useContext(SettingsContext);
