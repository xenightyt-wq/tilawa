import { useState } from 'react';
import type { Nav } from '../App';
import { TopBar } from '../components/TopBar';
import { DEFAULT_ZONE, ZonePicker, zoneRange, type Zone } from '../components/ZonePicker';
import { useT, type Key } from '../lib/i18n';
import { useQuran } from '../lib/quranData';
import { useSettings, type MaskLevel } from '../lib/settings';
import { rangeTitle } from './Recite';

const MASKS: MaskLevel[] = ['all', 'first-word', 'ayah-start', 'alternate'];

export function Select({ nav }: { nav: Nav }) {
  const t = useT();
  const q = useQuran();
  const { settings, update } = useSettings();
  const [zone, setZone] = useState<Zone>(DEFAULT_ZONE);
  const [memorize, setMemorize] = useState(false);
  const [from, to] = zoneRange(q, zone);

  return (
    <div className="screen">
      <TopBar nav={nav} title={t('newRecitation')} />
      <div className="form card">
        <ZonePicker value={zone} onChange={setZone} />
        <p className="muted summary">
          {rangeTitle(q, from, to)} · {to - from + 1} {t('verses')}
        </p>

        <fieldset className="field">
          <legend>{t('mode')}</legend>
          <label className="radio">
            <input type="radio" checked={!memorize} onChange={() => setMemorize(false)} /> {t('modeRecite')}
          </label>
          <label className="radio">
            <input type="radio" checked={memorize} onChange={() => setMemorize(true)} data-testid="mode-memorize" />{' '}
            {t('modeMemorize')}
          </label>
        </fieldset>

        {memorize && (
          <label className="field">
            <span>{t('mask')}</span>
            <select value={settings.mask} onChange={(e) => update({ mask: e.target.value as MaskLevel })}>
              {MASKS.map((m) => (
                <option key={m} value={m}>
                  {t(`mask_${m}` as Key)}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          className="btn btn-block"
          data-testid="start"
          onClick={() =>
            nav.replace({
              name: 'recite',
              job: {
                kind: memorize ? 'memorize' : 'recite',
                segments: [[from, to]],
                mask: memorize ? settings.mask : 'none',
              },
            })
          }
        >
          {t('start')}
        </button>
      </div>
    </div>
  );
}
