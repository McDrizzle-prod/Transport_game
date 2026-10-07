// Side panel (desktop) / bottom sheet (mobile) with tabs.
import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useStore, useUi } from '../state/store';
import type { Tab } from '../state/store';
import { ActionsTab } from './ActionsTab';
import { ExchangeTab } from './ExchangeTab';
import { HelpTab } from './HelpTab';
import { InfoTab } from './InfoTab';
import { LobbyTab } from './LobbyTab';
import { MarketTab } from './MarketTab';
import { PlayersTab } from './PlayersTab';
import { ReportTab } from './ReportTab';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'actions', icon: '🧭', label: 'Acties' },
  { id: 'info', icon: 'ℹ️', label: 'Info' },
  { id: 'report', icon: '📰', label: 'Rapport' },
  { id: 'market', icon: '📈', label: 'Markt' },
  { id: 'exchange', icon: '💼', label: 'Beurs' },
  { id: 'players', icon: '👥', label: 'Spelers' },
  { id: 'help', icon: '❓', label: 'Uitleg' },
];

/** Tells the map which part of the screen the panels cover, so it can centre things in the free part. */
function useReportInsets(ref: RefObject<HTMLElement | null>) {
  const store = useStore();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const wide = window.matchMedia('(min-width: 900px)').matches;
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      const toolbar = document.querySelector('.toolbar')?.getBoundingClientRect();
      document.documentElement.style.setProperty('--sheet-h', `${Math.round(window.innerHeight - r.top)}px`);
      store.setInsets(
        wide
          ? { top, right: window.innerWidth - r.left, bottom: 0, left: toolbar ? toolbar.right : 0 }
          : { top, right: 0, bottom: window.innerHeight - r.top + (toolbar ? toolbar.height + 8 : 0), left: 0 },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref, store]);
}

export function Sheet() {
  const store = useStore();
  const ref = useRef<HTMLElement>(null);
  useReportInsets(ref);
  const tab = useUi((s) => s.tab);
  const open = useUi((s) => s.sheetOpen);
  const phase = useUi((s) => s.view!.game.phase);
  const hasReport = useUi((s) => s.report !== null);
  const invited = useUi((s) => !!s.view?.game.invites.some((i) => i.to === s.view?.you?.playerId));
  const auctions = useUi((s) => !!s.view?.game.auctions.some((a) => a.status === 'open'));
  return (
    <aside ref={ref} className={`sheet ${open ? 'open' : 'closed'}`}>
      <div className="sheet-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-label={t.label}
            aria-selected={tab === t.id}
            className={`sheet-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => store.setTab(t.id)}
          >
            <span>{t.icon}</span>
            <span className="sheet-tab-label">{t.id === 'actions' && phase === 'lobby' ? 'Start' : t.label}</span>
            {((t.id === 'report' && hasReport) || (t.id === 'players' && invited) || (t.id === 'exchange' && auctions)) && <i className="dot" />}
          </button>
        ))}
        <button className="sheet-toggle" onClick={() => store.toggleSheet()} aria-label={open ? 'Paneel inklappen' : 'Paneel uitklappen'}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="sheet-body">
          {tab === 'actions' && (phase === 'lobby' ? <LobbyTab /> : <ActionsTab />)}
          {tab === 'info' && <InfoTab />}
          {tab === 'report' && <ReportTab />}
          {tab === 'market' && <MarketTab />}
          {tab === 'exchange' && <ExchangeTab />}
          {tab === 'players' && <PlayersTab />}
          {tab === 'help' && <HelpTab />}
        </div>
      )}
    </aside>
  );
}
