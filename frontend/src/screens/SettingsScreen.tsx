import { useState } from 'react';
import type { Nav } from '../App';
import { TopBar } from '../components/TopBar';
import { useT } from '../lib/i18n';
import { RECITERS, useSettings, type Settings } from '../lib/settings';

export function SettingsScreen({ nav }: { nav: Nav }) {
  const t = useT();
  const { settings: s, update } = useSettings();
  const [test, setTest] = useState<string | null>(null);

  const radio = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          role="radio"
          aria-checked={s[key] === v}
          className={s[key] === v ? 'on' : ''}
          onClick={() => update({ [key]: v } as Partial<Settings>)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const testServer = async () => {
    setTest('…');
    try {
      const base = s.serverUrl ? s.serverUrl.replace(/^ws/, 'http').replace(/\/ws\/asr$/, '') : '';
      const r = await fetch(`${base}/api/health`);
      const j = await r.json();
      setTest(j.ok ? t('serverOk', { model: j.model, device: j.device }) : `${t('serverKo')} : ${j.error}`);
    } catch {
      setTest(t('serverKo'));
    }
  };

  return (
    <div className="screen">
      <TopBar nav={nav} title={t('settings')} />
      <div className="form card">
        <div className="field">
          <span>{t('language')}</span>
          {radio('lang', [
            ['fr', 'Français'],
            ['ar', 'العربية'],
            ['en', 'English'],
          ])}
        </div>
        <div className="field">
          <span>{t('theme')}</span>
          {radio('theme', [
            ['auto', t('theme_auto')],
            ['light', t('theme_light')],
            ['dark', t('theme_dark')],
          ])}
        </div>
        <label className="field">
          <span>
            {t('fontSize')} : {s.fontSize}px
          </span>
          <input
            type="range"
            min={20}
            max={56}
            step={2}
            value={s.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          />
          <span className="preview-ar" lang="ar" dir="rtl" style={{ fontSize: s.fontSize }}>
            ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.tajweed} onChange={(e) => update({ tajweed: e.target.checked })} />
          {t('tajweed')}
        </label>
        <p className="muted small">{t('tajweedHelp')}</p>

        <div className="field">
          <span>{t('correctionMode')}</span>
          {radio('mode', [
            ['stop', t('mode_stop')],
            ['end', t('mode_end')],
          ])}
        </div>
        <div className="field">
          <span>{t('strictness')}</span>
          {radio('strictness', [
            ['strict', t('strict')],
            ['lenient', t('lenient')],
          ])}
        </div>
        <div className="field">
          <span>{t('feedback')}</span>
          <label className="check">
            <input type="checkbox" checked={s.sound} onChange={(e) => update({ sound: e.target.checked })} />
            {t('sound')}
          </label>
          <label className="check">
            <input type="checkbox" checked={s.vibrate} onChange={(e) => update({ vibrate: e.target.checked })} />
            {t('vibration')}
          </label>
        </div>
        <label className="field">
          <span>{t('reciter')}</span>
          <select value={s.reciter} onChange={(e) => update({ reciter: e.target.value })}>
            {RECITERS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>{t('engine')}</span>
          {radio('engine', [
            ['server', t('engine_server')],
            ['simulation', t('engine_simulation')],
          ])}
        </div>
        {s.engine === 'server' && (
          <label className="field">
            <span>{t('serverUrl')}</span>
            <div className="inline">
              <input
                type="url"
                placeholder="wss://mon-serveur.example/ws/asr"
                value={s.serverUrl}
                onChange={(e) => update({ serverUrl: e.target.value.trim() })}
              />
              <button className="btn btn-ghost" onClick={testServer} type="button">
                {t('testServer')}
              </button>
            </div>
            {test && <span className="muted small">{test}</span>}
          </label>
        )}
        <div className="field">
          <span>{t('privacy')}</span>
          <p className="muted small">{t('privacyText')}</p>
        </div>
      </div>
    </div>
  );
}
