// Panels for the active tool: lay a route, place a station, buy vehicles, place the headquarters.
import {
  CARGO,
  HQ_BONUS,
  INDUSTRIES,
  MAX_VEHICLES_PER_ACTION,
  MIN_HQ_DISTANCE,
  STATIONS,
  TICKS_PER_TURN,
  TRANSPORT,
  VEHICLES,
  checkStationTile,
  cityPassengers,
  coverageAt,
  estimateLine,
  stationLinked,
  transferPartners,
} from '@transport/shared';
import type { CargoId, StationKind, VehicleModelId } from '@transport/shared';
import { dec, money, num, tileLabel } from '../format';
import { TRANSPORT_ICON, cargoLabel, msgText, reasonText } from '../i18n';
import { useStore, useUi } from '../state/store';
import { rememberStation } from './ToolBar';

/** Explains where an action goes when every slot of this turn is used: the queue for the next turns. */
function SlotsFull() {
  const store = useStore();
  useUi((s) => s.draft);
  const queue = useUi((s) => s.queue);
  if (store.targetSlot() >= 0) return null;
  return (
    <p className="hint small">
      Al je {store.slotCount()} actieslots van deze beurt zijn gevuld: deze actie komt in de <strong>wachtrij</strong> en wordt in beurt{' '}
      {store.queueTurn(queue.length)} uitgevoerd.
    </p>
  );
}

function SlotTarget() {
  const store = useStore();
  useUi((s) => s.draft);
  useUi((s) => s.queue);
  const slot = store.targetSlot();
  return slot < 0 ? <span className="badge queued">→ wachtrij</span> : <span className="badge slotbadge">→ slot {slot + 1}</span>;
}

/** Text of the confirm button of the station and vehicle tools. */
function confirmText(slot: number, editing: boolean): string {
  return slot < 0 ? '⏭ In de wachtrij' : `✓ ${editing ? 'Bijwerken' : 'In slot'} ${slot + 1}`;
}

/** Free action slots: a route needs one per segment; the rest goes to the queue. */
function FreeSlots() {
  const store = useStore();
  useUi((s) => s.draft);
  const free = store.freeSlots().length;
  return <span className={`badge ${free ? 'slotbadge' : 'queued'}`}>{free ? `${free} vrije acties` : 'slots vol → wachtrij'}</span>;
}

export function RouteToolPanel() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.draft);
  if (tool.kind !== 'route') return null;
  const plan = store.routePlan();
  const actions = plan ? store.routeActions(plan) : [];
  const free = store.freeSlots().length;
  const stationKind = TRANSPORT[tool.transport].station;
  const blocked = plan?.plan?.blocked ?? [];
  const name = TRANSPORT[tool.transport].name.toLowerCase();

  return (
    <section className="panel-section tool-panel">
      <div className="section-head">
        <h3>
          {TRANSPORT_ICON[tool.transport]} {TRANSPORT[tool.transport].name} aanleggen
        </h3>
        <FreeSlots />
      </div>
      <ol className="route-steps">
        <li className={tool.path.length > 0 ? 'done' : 'now'}>Tik op het beginpunt (A).</li>
        <li className={tool.path.length > 1 ? 'done' : tool.path.length === 1 ? 'now' : ''}>
          Tik op het eindpunt (B). Je {name} loopt in een rechte lijn van A naar B en staat dan vast: tikken op de kaart verandert hem niet meer.
        </li>
        <li className={tool.path.length > 1 ? 'now' : ''}>
          Klopt de ligging? Tik op het groene vinkje ✓. Een bocht nodig? Tik op ＋ en dan op het volgende punt; ↶ haalt het laatste punt weg.
        </li>
      </ol>
      <p className="muted small">
        Elk stuk van tegel naar tegel kost <strong>1 actie</strong> (een station ook). Past de route niet in deze beurt, dan gaat de rest in de
        wachtrij: die acties komen vanzelf in je slots van de volgende beurten.
      </p>
      {plan?.plan?.fatal && <p className="error">{msgText(plan.plan.fatal)}</p>}
      {plan?.path && plan.plan && !plan.plan.fatal && (
        <p className="route-summary">
          <strong>{num(actions.length)} acties</strong> · {money(plan.plan.cost)}
          {actions.length > free && (
            <span className="small">
              {' '}
              · {free > 0 ? `${free} deze beurt, ` : ''}
              {actions.length - free} in de wachtrij voor de volgende beurten
            </span>
          )}
        </p>
      )}
      {blocked.length > 0 && <p className="warn">⚠ {blocked.length} tegel(s) zijn al van een andere speler; daar kun je niet bouwen.</p>}
      {stationKind && (
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={tool.stationStart} onChange={(e) => store.setTool({ ...tool, stationStart: e.target.checked })} />
            {STATIONS[stationKind].icon} {STATIONS[stationKind].name} bij A (+1 actie)
          </label>
          <label className="check">
            <input type="checkbox" checked={tool.stationEnd} onChange={(e) => store.setTool({ ...tool, stationEnd: e.target.checked })} />
            {STATIONS[stationKind].icon} {STATIONS[stationKind].name} bij B (+1 actie)
          </label>
          <span className="muted small">
            {money(STATIONS[stationKind].cost)} per station · bereik {STATIONS[stationKind].radius} tegel rondom: bouw het direct naast een industrie of
            stad. Een {STATIONS[stationKind].name.toLowerCase()} naast je {name} is er ook mee verbonden.
          </span>
        </div>
      )}
      <p className="muted small desktop-only">
        {money(TRANSPORT[tool.transport].edgeCost)} per stuk op gras; bos, heuvels, bruggen en tunnels zijn duurder. Je eigen netwerk hergebruiken kost
        geen actie. Met een muis zie je vooraf (gestippeld) waar het volgende stuk komt.
      </p>
      {tool.transport === 'canal' && (
        <p className="muted small">Schepen varen vrij over open water. Een kanaal verbindt water over land; bouw er havens (⚓) naast.</p>
      )}
    </section>
  );
}

/** Floating bar on the map while laying a route: what it costs, take a point back, cancel, and the green ✓. */
export function RouteBar() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.draft);
  if (tool.kind !== 'route') return null;
  const plan = store.routePlan();
  const actions = plan ? store.routeActions(plan) : [];
  const free = store.freeSlots().length;
  const ok = !!plan?.plan && !plan.plan.fatal && actions.length > 0 && actions.length - free <= store.queueRoom();
  const text =
    tool.path.length === 0
      ? 'Tik op het beginpunt (A)'
      : tool.path.length === 1
        ? 'Tik op het eindpunt (B)'
        : tool.adding
          ? 'Tik op het volgende punt'
          : plan?.plan && !plan.plan.fatal
          ? `${num(actions.length)} acties · ${money(plan.plan.cost)}${actions.length > free ? ` · ${actions.length - free} naar wachtrij` : ''}`
          : 'Deze route kan niet';
  return (
    <div className="route-bar" role="toolbar" aria-label="Route">
      <span className="route-bar-text">
        {TRANSPORT_ICON[tool.transport]} {text}
      </span>
      <button className="icon-btn" aria-label="Laatste punt terug" title="Laatste punt terug" disabled={tool.path.length === 0} onClick={() => store.undoRoutePoint()}>
        ↶
      </button>
      {tool.points.length >= 2 && (
        <button
          className={`icon-btn ${tool.adding ? 'active' : ''}`}
          aria-label="Punt toevoegen"
          aria-pressed={!!tool.adding}
          title="Nog een punt (bocht) toevoegen"
          onClick={() => store.toggleRouteAdding()}
        >
          ＋
        </button>
      )}
      <button className="icon-btn" aria-label="Annuleren" title="Annuleren" onClick={() => store.setTool({ kind: 'inspect' })}>
        ✕
      </button>
      <button className="confirm-btn" aria-label="Route plannen" title="Route plannen" disabled={!ok || !!tool.adding} onClick={() => store.confirmRoute()}>
        ✓
      </button>
    </div>
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
  const linked = world && tile !== null && check?.ok && !check.exists ? stationLinked(world, me.id, tool.station, tile) : null;
  const network = tool.station === 'rail' ? 'spoor' : 'weg';
  const partners = world && tile !== null && check?.ok ? transferPartners(world, { kind: tool.station, tile }, me.id) : [];

  return (
    <section className="panel-section tool-panel">
      <div className="section-head">
        <h3>🚉 Station bouwen · 1 actie</h3>
        <SlotTarget />
      </div>
      <div className="segmented">
        {STATION_KINDS.map((k) => (
          <button
            key={k}
            className={tool.station === k ? 'active' : ''}
            onClick={() => {
              rememberStation(k);
              store.setTool({ ...tool, station: k });
            }}
          >
            {STATIONS[k].icon} {STATIONS[k].name}
            <small>
              {money(STATIONS[k].cost)} · bereik {STATIONS[k].radius}
            </small>
          </button>
        ))}
      </div>
      <p className="hint">
        {tool.tile === null
          ? 'Tik op een tegel direct naast een industrie of stad: het bereik is klein.'
          : `Gekozen tegel ${tileLabel(tool.tile, width)}.`}
        {tool.station === 'water' && ' Een haven moet aan het water liggen.'}
      </p>
      {check && !check.ok && <p className="error">Kan hier niet: {reasonText(check.reason)}</p>}
      {check?.ok && check.exists && <p className="warn">Hier staat al een station van jou.</p>}
      {linked === true && tool.station !== 'water' && <p className="ok-text small">🔗 Sluit aan op je {network}.</p>}
      {linked === false && (
        <p className="warn small">
          ⚠ Hier ligt (nog) geen {network} van jou op of direct naast: leg er een {network} naartoe, anders kunnen er geen voertuigen rijden.
        </p>
      )}
      {cov && <CoverageList industries={cov.industries.map((i) => i.id)} cities={cov.cities.map((c) => c.id)} />}
      {partners.length > 0 && (
        <p className="ok-text small">
          ⇄ Overslag met {partners.map((p) => `${STATIONS[p.kind].icon} ${p.name}`).join(', ')}: vracht die hier aankomt kan daar verder.
        </p>
      )}
      <SlotsFull />
      <div className="button-row">
        <button className="secondary" onClick={() => store.setTool({ kind: 'inspect' })}>
          Annuleren
        </button>
        <button
          className="primary"
          disabled={!canPlace}
          onClick={() => tool.tile !== null && store.addAction({ type: 'station', kind: tool.station, tile: tool.tile })}
        >
          {confirmText(slot, tool.editSlot !== null)}
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
              <small>
                vraagt {Object.keys(city.demand).map((c) => cargoLabel(c as CargoId)).join(', ')} · 👥 {cityPassengers(city)} passagiers per beurt
                naar andere steden
              </small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const MODEL_GROUPS: { kind: StationKind; label: string; models: VehicleModelId[] }[] = [
  { kind: 'road', label: 'Weg', models: ['truck', 'truck_heavy', 'bus'] },
  { kind: 'rail', label: 'Spoor', models: ['train_steam', 'train_diesel', 'train_passenger'] },
  { kind: 'water', label: 'Water', models: ['barge', 'cargo_ship', 'ferry'] },
];

const unit = (id: VehicleModelId) => (VEHICLES[id].carries === 'passengers' ? 'passagiers' : 'ton');

export function VehicleToolPanel() {
  const store = useStore();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.draft);
  const width = useUi((s) => s.map!.width);
  if (tool.kind !== 'vehicles') return null;
  const me = store.me()!;
  const world = store.planningWorld();
  // Estimate with everything planned this turn (also lines in later slots that take freight further).
  const full = store.preview()?.world ?? world;
  const model = VEHICLES[tool.model];
  const slot = store.targetSlot();
  const est = full && tool.from !== null && tool.to !== null ? estimateLine(full, me.id, tool.model, tool.from, tool.to, tool.count) : null;
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
            <span className="model-kind" title={STATIONS[g.kind].plural}>
              {STATIONS[g.kind].icon}
            </span>
            {g.models.map((id) => {
              const m = VEHICLES[id];
              return (
                <button
                  key={id}
                  className={`model ${tool.model === id ? 'active' : ''}`}
                  aria-pressed={tool.model === id}
                  onClick={() =>
                    store.setTool({
                      ...tool,
                      model: id,
                      chosen: true,
                      ...(VEHICLES[tool.model].kind !== m.kind ? { from: null, to: null } : {}),
                    })
                  }
                >
                  <span className="model-icon">{m.icon}</span>
                  <span className="model-name">{m.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="model-stats">
        <strong>
          {model.icon} {model.name}
        </strong>
        : {model.capacity} {unit(tool.model)} · {model.speed} tegels per beurt · {money(model.price)} + {money(model.upkeep)} per beurt · rijdt tussen{' '}
        {STATIONS[model.kind].icon} {STATIONS[model.kind].plural}
      </p>
      <p className="hint">
        {tool.from === null
          ? 'Tik op het eerste station (van jou of een bondgenoot; geplande stations tellen ook). Het soort voertuig past zich aan.'
          : tool.to === null
            ? `Tik op het tweede ${STATIONS[model.kind].name.toLowerCase()}.`
            : `${fromStation?.name ?? tileLabel(tool.from, width)} ⇄ ${toStation?.name ?? tileLabel(tool.to, width)}`}
        {model.carries === 'passengers' && ' Passagiers reizen tussen stations bij twee verschillende steden.'}
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
            <dd>
              {num(est.capacityPerTurn)} {unit(tool.model)} per beurt per richting
            </dd>
            {est.hqBonus && (
              <>
                <dt>Hoofdkantoor</dt>
                <dd className="pos">+{Math.round(HQ_BONUS.bonus * 100)}% bonus (beide stations in de buurt van je HQ)</dd>
              </>
            )}
          </dl>
          {est.flows.length === 0 ? (
            <p className="warn">
              {model.carries === 'passengers'
                ? 'Geen passagiers tussen deze stations: beide stations moeten bij een (andere) stad liggen.'
                : 'Geen vracht tussen deze stations: zorg dat bij het ene station iets wordt geproduceerd dat bij het andere station wordt gevraagd, of dat een andere lijn het daar overneemt (overslag).'}
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
                      {f.inbound && <small className="muted"> · van {f.origin.name}, overgeslagen</small>}
                      {f.via && f.via.length > 0 && (
                        <small className="transfer">
                          {' '}
                          · ⇄ {f.via.join(' ⇄ ')} · jouw deel {Math.round((f.share ?? 1) * 100)}%
                        </small>
                      )}
                      {f.excludedBy && <small className="neg"> · alleen voor {store.playerName(f.excludedBy)} (meerderheid aandelen)</small>}
                      {f.toll > 0 && <small className="muted"> · {Math.round(f.toll * 100)}% naar aandeelhouders</small>}
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
            Opbrengst = hoeveelheid × prijs × marktprijs × hemelsbrede afstand tussen herkomst en bestemming (voor passagiers: tussen de twee steden).
            Geld komt binnen zodra een voertuig aankomt.
            {est.flows.some((f) => f.via?.length) &&
              ' Bij overslag (⇄) komt het geld binnen als de vracht bij de klant is; elke lijn krijgt een deel naar de afstand die ze aflegt.'}
          </p>
        </div>
      )}
      <SlotsFull />
      <div className="button-row">
        <button className="secondary" onClick={() => store.setTool({ ...tool, from: null, to: null })} disabled={tool.from === null}>
          Opnieuw kiezen
        </button>
        <button className="secondary" onClick={() => store.setTool({ kind: 'inspect' })}>
          Annuleren
        </button>
        <button
          className="primary"
          disabled={tool.from === null || tool.to === null || !!kindMismatch}
          onClick={() =>
            tool.from !== null &&
            tool.to !== null &&
            store.addAction({ type: 'vehicles', model: tool.model, from: tool.from, to: tool.to, count: tool.count })
          }
        >
          {confirmText(slot, tool.editSlot !== null)}
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
        bij interessante industrieën en steden: daar begint je imperium.
      </p>
      <p className="small">
        🏢 <strong>Bonus:</strong> leveringen tussen twee stations die allebei binnen {HQ_BONUS.radius} tegels van je hoofdkantoor liggen, leveren{' '}
        {Math.round(HQ_BONUS.bonus * 100)}% extra op (het gestippelde vierkant op de kaart).
      </p>
      {tool.kind !== 'hq' && (
        <button className="primary" onClick={() => store.setTool({ kind: 'hq' })}>
          Hoofdkantoor plaatsen
        </button>
      )}
    </section>
  );
}
