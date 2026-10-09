import type { StationKind, TransportKind } from '@transport/shared';
import { useStore, useUi } from '../state/store';
import type { ToolState } from '../state/store';

let lastStation: StationKind = 'road';

/** Remembers the kind of station the player chose last, so the station tool starts with it. */
export function rememberStation(kind: StationKind): void {
  lastStation = kind;
}

/** Stations at the ends of a route cost an action each, so they are off unless the player switched them on. */
const stationChoice = (current: ToolState, transport: TransportKind) =>
  current.kind === 'route' && current.transport === transport
    ? { stationStart: current.stationStart, stationEnd: current.stationEnd }
    : { stationStart: false, stationEnd: false };

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
    make: (c) => ({ kind: 'route', transport: 'road', path: [], points: [], ...stationChoice(c, 'road') }),
    active: (t) => t.kind === 'route' && t.transport === 'road',
  },
  {
    id: 'rail',
    icon: '🛤️',
    label: 'Spoor',
    make: (c) => ({ kind: 'route', transport: 'rail', path: [], points: [], ...stationChoice(c, 'rail') }),
    active: (t) => t.kind === 'route' && t.transport === 'rail',
  },
  {
    id: 'canal',
    icon: '🌊',
    label: 'Kanaal',
    make: () => ({ kind: 'route', transport: 'canal', path: [], points: [], stationStart: false, stationEnd: false }),
    active: (t) => t.kind === 'route' && t.transport === 'canal',
  },
  {
    id: 'station',
    icon: '🚉',
    label: 'Station',
    // Starts with the kind of station built last (a loading point the first time).
    make: (c) => ({ kind: 'station', station: c.kind === 'station' ? c.station : lastStation, tile: null, editSlot: null }),
    active: (t) => t.kind === 'station',
  },
  {
    id: 'vehicles',
    icon: '🚂',
    label: 'Voertuigen',
    make: (c) =>
      c.kind === 'vehicles'
        ? { ...c, from: null, to: null, editSlot: null }
        : { kind: 'vehicles', from: null, to: null, model: 'truck', count: 1, editSlot: null, chosen: false },
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
