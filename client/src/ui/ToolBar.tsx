import { useStore, useUi } from '../state/store';
import type { ToolState } from '../state/store';

interface ToolButton {
  id: string;
  icon: string;
  label: string;
  make: (current: ToolState) => ToolState;
  active: (t: ToolState) => boolean;
}

const TOOLS: ToolButton[] = [
  { id: 'inspect', icon: '🔍', label: 'Bekijken', make: () => ({ kind: 'inspect' }), active: (t) => t.kind === 'inspect' },
  {
    id: 'road',
    icon: '🛣️',
    label: 'Weg',
    make: () => ({ kind: 'route', transport: 'road', waypoints: [], stationStart: true, stationEnd: true, editSlot: null }),
    active: (t) => t.kind === 'route' && t.transport === 'road',
  },
  {
    id: 'rail',
    icon: '🛤️',
    label: 'Spoor',
    make: () => ({ kind: 'route', transport: 'rail', waypoints: [], stationStart: true, stationEnd: true, editSlot: null }),
    active: (t) => t.kind === 'route' && t.transport === 'rail',
  },
  {
    id: 'canal',
    icon: '🌊',
    label: 'Kanaal',
    make: () => ({ kind: 'route', transport: 'canal', waypoints: [], stationStart: false, stationEnd: false, editSlot: null }),
    active: (t) => t.kind === 'route' && t.transport === 'canal',
  },
  {
    id: 'station',
    icon: '🚉',
    label: 'Station',
    make: (c) => ({ kind: 'station', station: c.kind === 'station' ? c.station : 'rail', tile: null, editSlot: null }),
    active: (t) => t.kind === 'station',
  },
  {
    id: 'vehicles',
    icon: '🚂',
    label: 'Voertuigen',
    make: () => ({ kind: 'vehicles', from: null, to: null, model: 'truck', count: 1, editSlot: null }),
    active: (t) => t.kind === 'vehicles',
  },
];

export function ToolBar() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  const view = useUi((s) => s.view)!;
  const me = view.game.players.find((p) => p.id === view.you?.playerId);
  if (!me || view.game.phase !== 'running' || me.hq === null) return null;
  return (
    <nav className="toolbar" aria-label="Gereedschap">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool ${t.active(tool) ? 'active' : ''}`}
          onClick={() => store.setTool(t.make(tool))}
          title={t.label}
          aria-pressed={t.active(tool)}
        >
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
