// Dutch texts for codes coming from the engine and the server.
import { CARGO, STATIONS, TRANSPORT, VEHICLES } from '@transport/shared';
import type { Action, CargoId, Msg, StationKind, TransportKind, VehicleModelId } from '@transport/shared';
import { money, num } from './format';

export const GAME_TITLE = 'Transportrijk';

const REASONS: Record<string, string> = {
  bounds: 'buiten de kaart',
  terrain: 'ongeschikt terrein',
  city: 'bebouwing van een stad',
  industry: 'een industrie',
  hq: 'een hoofdkantoor',
  station: 'een station van een ander type of van een andere speler',
  occupied: 'een tegel van een andere speler',
  mixed: 'andere infrastructuur',
  no_water: 'er is geen water naast deze plek',
};

export const reasonText = (reason: unknown): string => REASONS[String(reason)] ?? String(reason);

export function msgText(m: Msg, playerName: (id: string) => string = (id) => id): string {
  switch (m.code) {
    case 'insufficient_funds':
      return `Onvoldoende geld: nodig ${money(Number(m.cost))}, beschikbaar ${money(Number(m.money))}`;
    case 'path_too_short':
      return 'De route is te kort';
    case 'path_too_long':
      return `De route is te lang (max. ${m.max} stukken per actie)`;
    case 'path_invalid':
      return 'Ongeldige route';
    case 'path_blocked':
      return `De route loopt over ${reasonText(m.reason)}`;
    case 'station_invalid':
      return `Station kan daar niet: ${reasonText(m.reason)}`;
    case 'station_exists':
      return 'Daar staat al een station van jou';
    case 'nothing_to_build':
      return 'Niets nieuws te bouwen: dit deel van je netwerk bestaat al';
    case 'station_conflict':
      return 'Station geweigerd: een andere speler bouwde in hetzelfde slot een ander soort station op deze tegel';
    case 'station_missing':
      return 'Geen station op het begin- of eindpunt (bouw het in een eerder actieslot)';
    case 'same_station':
      return 'Begin en eind zijn hetzelfde station';
    case 'station_kind':
      return 'Dit voertuig past niet bij dit soort station';
    case 'station_not_owned':
      return 'Je kunt alleen stations van jezelf of je bondgenoten gebruiken';
    case 'not_connected':
      return 'De stations zijn niet verbonden via jouw netwerk (of dat van je bondgenoten)';
    case 'invalid_action':
      return 'Ongeldige actie';
    case 'line_missing':
      return 'Deze lijn bestaat niet (meer)';
    case 'nothing_to_sell':
      return 'Deze lijn heeft geen voertuigen meer';
    case 'sold_fewer':
      return `Er waren maar ${m.count} voertuig(en) om te verkopen`;
    case 'crossing':
      return `Kruist een route van ${playerName(String(m.owner))}`;
    default:
      return errorText(m.code);
  }
}

const ERRORS: Record<string, string> = {
  network: 'Geen verbinding met de server',
  game_not_found: 'Spel niet gevonden. Controleer de code.',
  name_required: 'Vul een naam in',
  name_taken: 'Die naam is al in gebruik in dit spel. Kies een andere naam.',
  name_taken_pin: 'Die naam bestaat al in dit spel. Ben jij dat? Vul je pincode in om verder te spelen.',
  pin_invalid: 'De pincode moet uit 4 tot 8 cijfers bestaan',
  pin_wrong: 'Onjuiste pincode',
  too_many_attempts: 'Te vaak een verkeerde pincode: probeer het over 10 minuten opnieuw',
  too_many_games: 'Er zijn net te veel spellen gemaakt vanaf dit adres: probeer het later opnieuw',
  game_full: 'Dit spel zit vol',
  game_finished: 'Dit spel is afgelopen',
  unauthorized: 'Je bent geen speler in dit spel',
  host_only: 'Alleen de host kan dit doen',
  hq_invalid: 'Ongeldige plek',
  hq_terrain: 'Een hoofdkantoor kan niet op water of bergen',
  hq_occupied: 'Deze plek is al bezet',
  hq_too_close: 'Te dicht bij een ander hoofdkantoor',
  hq_fixed: 'Je hoofdkantoor staat al vast',
  not_running: 'Het spel is nog niet gestart',
  no_hq: 'Plaats eerst je hoofdkantoor',
  already_started: 'Het spel is al gestart',
  no_hq_placed: 'Er moet minstens één hoofdkantoor geplaatst zijn',
  slots_invalid: 'Ongeldige acties',
  too_large: 'Verzoek te groot',
  invalid_json: 'Ongeldig verzoek',
  internal: 'Er ging iets mis op de server',
  report_not_found: 'Rapport niet gevonden',
  unreachable: 'Geen route mogelijk naar dit punt',
  invalid_player: 'Onbekende speler',
  already_in_alliance: 'Die speler zit al in een alliantie',
  already_allied: 'Jullie zijn al bondgenoten',
  already_invited: 'Je hebt deze speler al uitgenodigd',
  no_invite: 'Er is geen voorstel (meer)',
  not_in_alliance: 'Je zit niet in een alliantie',
  invalid_request: 'Ongeldig verzoek',
  too_long: 'Te ver in één keer: kies een eindpunt dichterbij en bouw in delen',
  blocked_endpoint: 'Daar kun je niet bouwen',
  unknown_player: 'Plaats eerst je hoofdkantoor',
  auction_closed: 'Deze veiling is al gesloten',
  bid_invalid: 'Ongeldig bod',
  already_highest: 'Je hebt al het hoogste bod',
};

export function errorText(code: string, extra: Record<string, unknown> = {}): string {
  if (/^slot_\d+_invalid$/.test(code)) return `Actieslot ${code.split('_')[1]} is ongeldig`;
  switch (code) {
    case 'bid_too_low':
      return `Bod te laag: minimaal ${money(Number(extra.min))}`;
    case 'loan_amount':
      return `Lenen en aflossen gaat in stappen van ${money(Number(extra.step))}`;
    case 'loan_limit':
      return `Kredietlimiet bereikt: je kunt maximaal ${money(Number(extra.limit))} lenen (nu ${money(Number(extra.debt))})`;
    case 'repay_too_much':
      return `Je schuld is maar ${money(Number(extra.debt))}`;
    case 'insufficient_funds':
      return extra.cost !== undefined ? `Onvoldoende geld: nodig ${money(Number(extra.cost))}, beschikbaar ${money(Number(extra.money))}` : 'Onvoldoende geld';
  }
  return ERRORS[code] ?? code;
}

export const transportName = (k: TransportKind): string => TRANSPORT[k].name;
export const stationName = (k: StationKind): string => STATIONS[k].name;
export const vehicleName = (m: VehicleModelId): string => VEHICLES[m].name;
export const cargoLabel = (c: CargoId): string => `${CARGO[c].icon} ${CARGO[c].name}`;

export const TRANSPORT_ICON: Record<TransportKind, string> = { road: '🛣️', rail: '🛤️', canal: '🌊' };

/** One line describing an action in a slot. */
export function actionTitle(a: Action, width: number): string {
  switch (a.type) {
    case 'build': {
      const tile = (t: number) => `(${t % width}, ${Math.floor(t / width)})`;
      if (a.path.length === 2) return `${TRANSPORT_ICON[a.kind]} ${transportName(a.kind)} ${tile(a.path[0])} → ${tile(a.path[1])}`;
      const extra = [a.stationStart && 'station begin', a.stationEnd && 'station eind'].filter(Boolean).join(' + ');
      return `${TRANSPORT_ICON[a.kind]} ${transportName(a.kind)} · ${num(a.path.length - 1)} stukken${extra ? ` · ${extra}` : ''}`;
    }
    case 'station':
      return `${STATIONS[a.kind].icon} ${stationName(a.kind)} op (${a.tile % width}, ${Math.floor(a.tile / width)})`;
    case 'vehicles':
      return `${VEHICLES[a.model].icon} ${a.count}× ${vehicleName(a.model)}`;
    case 'sell':
      return `💰 ${a.count} voertuig${a.count > 1 ? 'en' : ''} verkopen (lijn ${a.line})`;
  }
}

export const OUTCOME_TEXT = { ok: 'Gelukt', partial: 'Deels gelukt', failed: 'Mislukt' } as const;
