// Panels for the active tool: lay a route, place a station, buy vehicles, place the headquarters.
import { CARGO, INDUSTRIES, MAX_ROUTE_EDGES, MAX_VEHICLES_PER_ACTION, MIN_HQ_DISTANCE, STATIONS, TICKS_PER_TURN, TRANSPORT, VEHICLES, checkStationTile, coverageAt, estimateLine } from '@transport/shared';
import type { CargoId, StationKind, VehicleModelId } from '@transport/shared';
import { dec, money, num, tileLabel } from '../format';
import { TRANSPORT_ICON, cargoLabel, errorText, msgText, reasonText } from '../i18n';
import { useStore, useUi } from '../state/store';

function SlotTarget() {
  const store = useStore();
  useUi((s) => s.draft);
  const slot = store.targetSlot();
  return slot < 0 ? <span className="badge failed">alle slots vol</span> : <span className="badge slotbadge">→ slot {slot + 1}</span>;
}

export function RouteToolPanel() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.draft);
  if (tool.kind !== 'route') return null;
  const plan = store.routePlan();
  const slot = store.targetSlot();
  const stationKind = TRANSPORT[tool.transport].station;
  const stationCost = stationKind ? STATIONS[stationKind].cost : 0;
  const ok = !!plan?.path && !plan.error && !plan.plan?.fatal;
  const blocked = plan?.plan?.blocked ?? [];
  const step =
    tool.waypoints.length === 0
      ? 'Tik op de kaart waar de route moet beginnen (bijv. naast een industrie).'
      : tool.waypoints.length === 1
        ? 'Tik op het eindpunt. Tussenpunten zijn ook mogelijk om de route te sturen.'
        : 'Tik om de route te verlengen, of zet hem in een actieslot.';

  const confirm = () => {
    if (!plan?.path) return;
    store.addAction({ type: 'build', kind: tool.transport, path: plan.path, stationStart: tool.stationStart, stationEnd: tool.stationEnd });
  };

  return (
    <section className="panel-section tool-panel">
      <div className="section-head">
        <h3>
          {TRANSPORT_ICON[tool.transport]} {TRANSPORT[tool.transport].name} aanleggen
        </h3>
        <SlotTarget />
      </div>
      <p className="hint">{step}</p>
      {plan?.error && <p className="error">{errorText(plan.error)}</p>}
      {plan?.plan?.fatal && <p className="error">{msgText(plan.plan.fatal)}</p>}
      {plan?.path && plan.plan && (
        <p className="route-summary">
          <strong>{money(plan.plan.cost)}</strong> · {num(plan.path.length - 1)} stukken{' '}
          <span className="muted small">(max. {MAX_ROUTE_EDGES} per actie)</span>
        </p>
      )}
      <p className="muted small desktop-only">
        {money(TRANSPORT[tool.transport].edgeCost)} per stuk op gras; bos, heuvels, bruggen en tunnels zijn duurder. Je eigen netwerk hergebruiken is
        gratis.
      </p>
      {blocked.length > 0 && (
        <p className="warn">⚠ {blocked.length} tegel(s) zijn al van een andere speler; daar kun je niet bouwen.</p>
      )}
      {stationKind && (
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={tool.stationStart} onChange={(e) => store.setTool({ ...tool, stationStart: e.target.checked })} />
            {STATIONS[stationKind].icon} {STATIONS[stationKind].name} aan het begin
          </label>
          <label className="check">
            <input type="checkbox" checked={tool.stationEnd} onChange={(e) => store.setTool({ ...tool, stationEnd: e.target.checked })} />
            {STATIONS[stationKind].icon} {STATIONS[stationKind].name} aan het eind
          </label>
          <span className="muted small">
            {money(stationCost)} per station · bereik {STATIONS[stationKind].radius} tegels rondom
          </span>
        </div>
      )}
      {tool.transport === 'canal' && (
        <p className="muted small">Schepen varen vrij over open water. Een kanaal verbindt water over land; bouw er havens (⚓) naast.</p>
      )}
      <div className="button-row">
        <button
          className="secondary"
          disabled={tool.waypoints.length === 0}
          onClick={() => store.setTool({ ...tool, waypoints: tool.waypoints.slice(0, -1) })}
        >
          ↶ Punt terug
        </button>
        <button className="secondary" onClick={() => store.setTool({ kind: 'inspect' })}>
          Annuleren
        </button>
        <button className="primary" disabled={!ok || slot < 0} onClick={confirm}>
          ✓ {tool.editSlot !== null ? 'Bijwerken' : 'In slot'} {slot + 1}
        </button>
      </div>
    </section>
  );
}

const STATION_KINDS: StationKind[] = ['road', 'rail', 'water'];

export function StationToolPanel() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  const hover = useUi((s) => s.hover);
  useUi((s) => s.draft);
  const width = useUi((s) => s.map!.width);
  if (tool.kind !== 'station') return null;
  const me = store.me()!;
  const world = store.planningWorld();
  const tile = tool.tile ?? hover;
  const check = world && tile !== null ? checkStationTile(world, me.id, tool.station, tile) : null;
  const cov = world && tile !== null ? coverageAt(world, tool.station, tile) : null;
  const slot = store.targetSlot();
  const canPlace = !!check && check.ok && !check.exists && tool.tile !== null;

  return (
    <section className="panel-section tool-panel">
      <div className="section-head">
        <h3>🚉 Station bouwen</h3>
        <SlotTarget />
      </div>
      <div className="segmented">
        {STATION_KINDS.map((k) => (
          <button key={k} className={tool.station === k ? 'active' : ''} onClick={() => store.setTool({ ...tool, station: k })}>
            {STATIONS[k].icon} {STATIONS[k].name}
            <small>
              {money(STATIONS[k].cost)} · bereik {STATIONS[k].radius}
            </small>
          </button>
        ))}
      </div>
      <p className="hint">
        {tool.tile === null ? 'Tik op een tegel naast industrieën of een stad.' : `Gekozen tegel ${tileLabel(tool.tile, width)}.`}
        {tool.station === 'water' && ' Een haven moet aan het water liggen.'}
      </p>
      {check && !check.ok && <p className="error">Kan hier niet: {reasonText(check.reason)}</p>}
      {check?.ok && check.exists && <p className="warn">Hier staat al een station van jou.</p>}
      {cov && <CoverageList industries={cov.industries.map((i) => i.id)} cities={cov.cities.map((c) => c.id)} />}
      <div className="button-row">
        <button className="secondary" onClick={() => store.setTool({ kind: 'inspect' })}>
          Annuleren
        </button>
        <button
          className="primary"
          disabled={!canPlace || slot < 0}
          onClick={() => tool.tile !== null && store.addAction({ type: 'station', kind: tool.station, tile: tool.tile })}
        >
          ✓ {tool.editSlot !== null ? 'Bijwerken' : 'In slot'} {slot + 1}
        </button>
      </div>
    </section>
  );
}

/** Which industries/cities a station would serve, with what they supply and accept. */
export function CoverageList({ industries, cities }: { industries: number[]; cities: number[] }) {
  const view = useUi((s) => s.view)!;
  const map = useUi((s) => s.map)!;
  if (!industries.length && !cities.length) return <p className="muted small">Geen industrieën of steden binnen bereik.</p>;
  return (
    <ul className="coverage">
      {industries.map((id) => {
        const ind = view.game.industries.find((i) => i.id === id)!;
        const def = INDUSTRIES[ind.type];
        return (
          <li key={`i${id}`}>
            <span className="cov-icon">{def.icon}</span>
            <span>
              <strong>{ind.name}</strong>
              <small>
                levert {cargoLabel(def.output)}
                {def.inputs && ` · vraagt ${Object.keys(def.inputs).map((c) => cargoLabel(c as CargoId)).join(' + ')}`}
              </small>
            </span>
          </li>
        );
      })}
      {cities.map((id) => {
        const city = map.cities.find((c) => c.id === id)!;
        return (
          <li key={`c${id}`}>
            <span className="cov-icon">🏙️</span>
            <span>
              <strong>{city.name}</strong>
              <small>vraagt {Object.keys(city.demand).map((c) => cargoLabel(c as CargoId)).join(', ')}</small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const MODEL_GROUPS: { kind: StationKind; label: string; models: VehicleModelId[] }[] = [
  { kind: 'road', label: 'Weg', models: ['truck', 'truck_heavy'] },
  { kind: 'rail', label: 'Spoor', models: ['train_steam', 'train_diesel'] },
  { kind: 'water', label: 'Water', models: ['barge', 'cargo_ship'] },
];

export function VehicleToolPanel() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.draft);
  const width = useUi((s) => s.map!.width);
  if (tool.kind !== 'vehicles') return null;
  const me = store.me()!;
  const world = store.planningWorld();
  const model = VEHICLES[tool.model];
  const slot = store.targetSlot();
  const est = world && tool.from !== null && tool.to !== null ? estimateLine(world, me.id, tool.model, tool.from, tool.to, tool.count) : null;
  const fromStation = tool.from !== null ? world?.stationAt.get(tool.from) : undefined;
  const toStation = tool.to !== null ? world?.stationAt.get(tool.to) : undefined;
  const kindMismatch = (fromStation && fromStation.kind !== model.kind) || (toStation && toStation.kind !== model.kind);
  const cost = model.price * tool.count;

  return (
    <section className="panel-section tool-panel">
      <div className="section-head">
        <h3>🚂 Voertuigen inzetten</h3>
        <SlotTarget />
      </div>
      <div className="models">
        {MODEL_GROUPS.map((g) => (
          <div key={g.kind} className="model-group">
            <span className="muted small">
              {STATIONS[g.kind].icon} {g.label}
            </span>
            {g.models.map((id) => {
              const m = VEHICLES[id];
              return (
                <button
                  key={id}
                  className={`model ${tool.model === id ? 'active' : ''}`}
                  onClick={() =>
                    store.setTool({
                      ...tool,
                      model: id,
                      ...(VEHICLES[tool.model].kind !== m.kind ? { from: null, to: null } : {}),
                    })
                  }
                >
                  <span className="model-icon">{m.icon}</span>
                  <span className="model-name">{m.name}</span>
                  <span className="model-stats">
                    {m.capacity} ton · {m.speed} tegels/beurt
                    <br />
                    {money(m.price)} + {money(m.upkeep)}/beurt
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="hint">
        {tool.from === null
          ? `Tik op het eerste ${STATIONS[model.kind].name.toLowerCase()} (van jou, mag ook gepland zijn).`
          : tool.to === null
            ? 'Tik op het tweede station.'
            : `${fromStation?.name ?? tileLabel(tool.from, width)} ⇄ ${toStation?.name ?? tileLabel(tool.to, width)}`}
      </p>
      {kindMismatch && <p className="error">Dit voertuig past niet bij dit soort station.</p>}
      <div className="stepper">
        <span>Aantal</span>
        <button className="icon-btn" aria-label="Minder" disabled={tool.count <= 1} onClick={() => store.setTool({ ...tool, count: tool.count - 1 })}>
          −
        </button>
        <strong>{tool.count}</strong>
        <button
          className="icon-btn"
          aria-label="Meer"
          disabled={tool.count >= MAX_VEHICLES_PER_ACTION}
          onClick={() => store.setTool({ ...tool, count: tool.count + 1 })}
        >
          +
        </button>
        <span className="muted">= {money(cost)}</span>
      </div>
      {est && !kindMismatch && (
        <div className="estimate-box">
          {!est.connected && <p className="error">De stations zijn (nog) niet verbonden door jouw netwerk.</p>}
          <dl className="stats">
            <dt>Route</dt>
            <dd>
              {dec(est.length)} tegels · rit {dec(est.tripTicks / TICKS_PER_TURN)} beurt
            </dd>
            <dt>Eerste opbrengst</dt>
            <dd>{est.firstDeliveryTurns <= 1 ? 'deze beurt' : `na ±${Math.ceil(est.firstDeliveryTurns)} beurten`}</dd>
            <dt>Capaciteit</dt>
            <dd>{num(est.capacityPerTurn)} ton per beurt per richting</dd>
          </dl>
          {est.flows.length === 0 ? (
            <p className="warn">
              Geen vracht tussen deze stations: zorg dat bij het ene station iets wordt geproduceerd dat bij het andere station wordt gevraagd.
            </p>
          ) : (
            <table className="flows">
              <thead>
                <tr>
                  <th>Vracht</th>
                  <th>Afstand</th>
                  <th>Per beurt</th>
                  <th>Opbrengst</th>
                </tr>
              </thead>
              <tbody>
                {est.flows.map((f, k) => (
                  <tr key={k}>
                    <td>
                      {CARGO[f.cargo].icon} {f.direction === 0 ? '→' : '←'} <small>{f.consumer.name}</small>
                    </td>
                    <td>{dec(f.distance)}</td>
                    <td>{num(f.amountPerTurn)}</td>
                    <td>{money(f.revenuePerTurn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="stats totals">
            <dt>Opbrengst per beurt</dt>
            <dd>{money(est.revenuePerTurn)}</dd>
            <dt>Onderhoud per beurt</dt>
            <dd>−{money(est.upkeepPerTurn)}</dd>
            <dt>Netto per beurt</dt>
            <dd className={est.netPerTurn >= 0 ? 'pos' : 'neg'}>{money(est.netPerTurn)}</dd>
            <dt>Terugverdientijd</dt>
            <dd>{est.paybackTurns !== null ? `${dec(est.paybackTurns)} beurten` : '—'}</dd>
          </dl>
          <p className="muted small">
            Opbrengst = hoeveelheid × prijs × marktprijs × hemelsbrede afstand tussen herkomst en bestemming. Geld komt binnen zodra een voertuig
            aankomt.
          </p>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" onClick={() => store.setTool({ ...tool, from: null, to: null })} disabled={tool.from === null}>
          Opnieuw kiezen
        </button>
        <button className="secondary" onClick={() => store.setTool({ kind: 'inspect' })}>
          Annuleren
        </button>
        <button
          className="primary"
          disabled={tool.from === null || tool.to === null || !!kindMismatch || slot < 0}
          onClick={() =>
            tool.from !== null &&
            tool.to !== null &&
            store.addAction({ type: 'vehicles', model: tool.model, from: tool.from, to: tool.to, count: tool.count })
          }
        >
          ✓ {tool.editSlot !== null ? 'Bijwerken' : 'In slot'} {slot + 1}
        </button>
      </div>
    </section>
  );
}

export function HqToolPanel() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  return (
    <section className="panel-section tool-panel">
      <h3>🏢 Plaats je hoofdkantoor</h3>
      <p className="hint">
        Tik op een vrije plek op de kaart. Het hoofdkantoor moet minstens {MIN_HQ_DISTANCE} tegels van andere hoofdkantoren staan. Kies een plek
        bij interessante industrieën: daar begint je imperium.
      </p>
      {tool.kind !== 'hq' && (
        <button className="primary" onClick={() => store.setTool({ kind: 'hq' })}>
          Hoofdkantoor plaatsen
        </button>
      )}
    </section>
  );
}
