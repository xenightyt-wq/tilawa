import type { ReactNode } from 'react';
import { useT } from '../lib/i18n';
import type { Nav } from '../App';
import { Icon } from './Icon';

export function TopBar({ nav, title, sub, right }: { nav: Nav; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  const t = useT();
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={nav.back} aria-label={t('back')}>
        <Icon name="back" />
      </button>
      <div className="topbar-title">
        <h1>{title}</h1>
        {sub && <div className="topbar-sub">{sub}</div>}
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
