// Details of the selected tile: industry, city, station, headquarters, infrastructure, terrain.
import { CARGO, INDUSTRIES, STATIONS, TERRAIN, TRANSPORT, TileUse, VEHICLES, coversIndustry, stationCoverage } from '@transport/shared';
import type { CargoId, Station } from '@transport/shared';
import { money, num, tileLabel } from '../format';
import { cargoLabel } from '../i18n';
import { useStore, useUi } from '../state/store';
import { CoverageList } from './ToolPanels';

export function InfoTab() {
  const store = useStore();
  const selection = useUi((s) => s.selection);
  const view = useUi((s) => s.view)!;
  const map = useUi((s) => s.map)!;
  if (selection === null) {
    return (
      <section className="panel-section">
        <h3>Info</h3>
        <p className="muted">Kies 🔍 Bekijken en tik op de kaart: een industrie, stad, station of stuk spoor.</p>
      </section>
    );
  }
  const game = view.game;
  const w = map.width;
  const x = selection % w;
  const y = Math.floor(selection / w);
  const industry = game.industries.find((i) => x >= i.x && x < i.x + i.w && y >= i.y && y < i.y + i.h);
  const city = map.cities.find((c) => c.tiles.includes(selection));
  const station = game.stations.find((s) => s.tile === selection);
  const hqOwner = game.players.find((p) => p.hq === selection);
  const info = game.infra.tiles[selection];
  const world = store.world();
  const edges = world ? world.edgesAt(selection) : [];
  const terrain = TERRAIN[map.terrain[selection] as keyof typeof TERRAIN];
  const name = store.playerName;

  return (
    <section className="panel-section info">
      {industry && <IndustryInfo id={industry.id} />}
      {city && <CityInfo id={city.id} />}
      {station && <StationInfo station={station} />}
      {hqOwner && (
        <div className="info-block">
          <h3>🏢 Hoofdkantoor van {hqOwner.name}</h3>
          <p>
            Kapitaal: <strong>{money(hqOwner.money)}</strong>
          </p>
        </div>
      )}
      <div className="info-block">
        <h4>Tegel {tileLabel(selection, w)}</h4>
        <p className="muted small">
          {terrain.name}
          {map.use[selection] === TileUse.CityStreet && ' · openbare straat (vrij te gebruiken door vrachtwagens)'}
          {terrain.land !== null && ` · bouwprijs ×${terrain.land}${map.terrain[selection] === 0 ? ' (brug)' : terrain.land >= 4 ? ' (tunnel)' : ''}`}
        </p>
        {info && (
          <p className="small">
            Eigenaar: {info.owners.map(name).join(' & ')} · geclaimd in beurt {info.turn}, slot {info.slot}
            {info.owners.length > 1 && ' (gedeeld: zelfde slot)'}
          </p>
        )}
        {edges.length > 0 && (
          <ul className="small plain">
            {edges.map((e) => (
              <li key={`${e.kind}${e.a}${e.b}`}>
                {TRANSPORT[e.kind].name} naar {tileLabel(e.a === selection ? e.b : e.a, w)} · van {e.owners.map(name).join(' & ')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function IndustryInfo({ id }: { id: number }) {
  const view = useUi((s) => s.view)!;
  const width = useUi((s) => s.map!.width);
  const ind = view.game.industries.find((i) => i.id === id)!;
  const def = INDUSTRIES[ind.type];
  const prices = view.game.market.prices;
  const serving = view.game.stations.filter((s) => coversIndustry(s.kind, s.tile, width, ind));
  return (
    <div className="info-block">
      <h3>
        {def.icon} {ind.name}
      </h3>
      <dl className="stats">
        <dt>Levert</dt>
        <dd>
          {cargoLabel(def.output)} · {def.inputs ? `max. ${ind.rate}` : ind.rate} per beurt
        </dd>
        {def.inputs && (
          <>
            <dt>Vraagt</dt>
            <dd>
              {Object.entries(def.inputs).map(([c, r]) => (
                <span key={c} className="pill">
                  {cargoLabel(c as CargoId)} {r !== 1 ? `×${r}` : ''} · voorraad {num(ind.input[c as CargoId] ?? 0)}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>Voorraad</dt>
        <dd>{num(ind.stock)}</dd>
        <dt>Vorige beurt</dt>
        <dd>
          geproduceerd {num(ind.stats.produced)} · afgevoerd {num(ind.stats.shipped)}
        </dd>
        <dt>Prijs</dt>
        <dd>
          {money(CARGO[def.output].price * (prices[def.output] ?? 1))} per ton per tegel afstand
        </dd>
      </dl>
      {def.inputs && ind.stats.produced === 0 && <p className="hint">Deze fabriek produceert pas als er grondstoffen worden aangeleverd.</p>}
      <p className="small muted">
        {serving.length ? `Bediend door: ${serving.map((s) => s.name).join(', ')}` : 'Nog geen stations in de buurt.'}
      </p>
    </div>
  );
}

function CityInfo({ id }: { id: number }) {
  const view = useUi((s) => s.view)!;
  const map = useUi((s) => s.map)!;
  const city = map.cities.find((c) => c.id === id)!;
  const got = view.game.cityStats[String(id)] ?? {};
  const prices = view.game.market.prices;
  return (
    <div className="info-block">
      <h3>🏙️ {city.name}</h3>
      <p className="small muted">{num(city.population)} inwoners</p>
      <table className="flows">
        <thead>
          <tr>
            <th>Vraagt</th>
            <th>Per beurt</th>
            <th>Geleverd</th>
            <th>Prijs</th>
          </tr>
        </thead>
        <tbody>
          {(Object.entries(city.demand) as [CargoId, number][]).map(([c, amount]) => (
            <tr key={c}>
              <td>{cargoLabel(c)}</td>
              <td>{amount}</td>
              <td>{num(got[c] ?? 0)}</td>
              <td>×{(prices[c] ?? 1).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Meer leveren dan gevraagd mag, maar levert maar 40% van de prijs op.</p>
    </div>
  );
}

function StationInfo({ station }: { station: Station }) {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const world = store.world();
  const me = view.you?.playerId;
  const cov = world ? stationCoverage(world, station) : null;
  const lines = view.game.lines.filter((l) => l.stations.includes(station.id));
  const def = STATIONS[station.kind];
  return (
    <div className="info-block">
      <h3>
        {def.icon} {station.name}
      </h3>
      <p className="small muted">
        {def.name} van {station.owners.map(store.playerName).join(' & ')} · bereik {def.radius} · gebouwd in beurt {station.builtTurn}
      </p>
      {station.waiting.length > 0 && (
        <p className="small">
          Wacht op transport:{' '}
          {station.waiting.map((l) => (
            <span key={`${l.cargo}${l.origin}`} className="pill">
              {CARGO[l.cargo].icon} {l.amount}
            </span>
          ))}
        </p>
      )}
      {cov && <CoverageList industries={cov.industries.map((i) => i.id)} cities={cov.cities.map((c) => c.id)} />}
      {lines.length > 0 && (
        <>
          <h4>Lijnen</h4>
          <ul className="plain small">
            {lines.map((l) => {
              const vs = view.game.vehicles.filter((v) => v.lineId === l.id);
              return (
                <li key={l.id}>
                  <strong>{l.name}</strong> · {vs.length}× {vs[0] ? VEHICLES[vs[0].model].icon : ''} · {l.length ? `${l.length} tegels` : 'geen verbinding!'}
                  {' · '}vorige beurt {money(l.stats.revenue)} ({l.stats.trips} ritten)
                </li>
              );
            })}
          </ul>
        </>
      )}
      {me && station.owners.includes(me) && view.game.phase === 'running' && (
        <button
          className="secondary"
          onClick={() =>
            store.setTool({
              kind: 'vehicles',
              from: station.tile,
              to: null,
              model: station.kind === 'road' ? 'truck' : station.kind === 'rail' ? 'train_steam' : 'barge',
              count: 1,
              editSlot: null,
            })
          }
        >
          🚂 Voertuigen vanaf dit station
        </button>
      )}
    </div>
  );
}
