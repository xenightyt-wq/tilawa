import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuranData } from './core/quran';
import { kvGet, kvSet } from './lib/db';
import { translate } from './lib/i18n';
import { loadQuran, QuranContext } from './lib/quranData';
import { DEFAULT_SETTINGS, SettingsContext, type Settings } from './lib/settings';
import { About } from './screens/About';
import { Home } from './screens/Home';
import { Quiz } from './screens/Quiz';
import { Recite, type ReciteJob } from './screens/Recite';
import { Review } from './screens/Review';
import { Select } from './screens/Select';
import { SettingsScreen } from './screens/SettingsScreen';
import { Stats } from './screens/Stats';

export type Route =
  | { name: 'home' }
  | { name: 'select' }
  | { name: 'recite'; job: ReciteJob }
  | { name: 'quiz' }
  | { name: 'review' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'about' };

export interface Nav {
  go(r: Route): void;
  back(): void;
  replace(r: Route): void;
}

export function App() {
  const [quran, setQuran] = useState<QuranData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  useEffect(() => {
    loadQuran().then(setQuran, (e) => setLoadError(String(e)));
    kvGet<Partial<Settings>>('settings').then((s) => s && setSettings({ ...DEFAULT_SETTINGS, ...s }));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      void kvSet('settings', next);
      return next;
    });
  }, []);

  // Thème, langue et direction du document
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    root.lang = settings.lang;
    root.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
  }, [settings.theme, settings.lang]);

  // Bouton "retour" du téléphone / navigateur
  useEffect(() => {
    const onPop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const nav = useMemo<Nav>(
    () => ({
      go: (r) => {
        history.pushState({ depth: Date.now() }, '');
        setStack((s) => [...s, r]);
        window.scrollTo(0, 0);
      },
      back: () => history.back(),
      replace: (r) => setStack((s) => [...s.slice(0, -1), r]),
    }),
    [],
  );

  const route = stack[stack.length - 1];
  const ctx = useMemo(() => ({ settings, update }), [settings, update]);

  if (loadError) return <div className="fatal">{loadError}</div>;
  if (!quran)
    return (
      <div className="loading" aria-busy="true">
        {translate(settings.lang, 'appName')}…
      </div>
    );

  return (
    <SettingsContext.Provider value={ctx}>
      <QuranContext.Provider value={quran}>
        {route.name === 'home' && <Home nav={nav} />}
        {route.name === 'select' && <Select nav={nav} />}
        {route.name === 'recite' && <Recite key={JSON.stringify(route.job)} nav={nav} job={route.job} />}
        {route.name === 'quiz' && <Quiz nav={nav} />}
        {route.name === 'review' && <Review nav={nav} />}
        {route.name === 'stats' && <Stats nav={nav} />}
        {route.name === 'settings' && <SettingsScreen nav={nav} />}
        {route.name === 'about' && <About nav={nav} />}
      </QuranContext.Provider>
    </SettingsContext.Provider>
  );
}
