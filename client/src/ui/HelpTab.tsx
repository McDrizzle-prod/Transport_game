// Short explanation of the rules.
import {
  AUCTIONS,
  CARGO,
  HQ_BONUS,
  LOANS,
  OVERSUPPLY_PRICE_FACTOR,
  STATIONS,
  TICKS_PER_TURN,
  TRANSPORT,
  VEHICLES,
  VEHICLE_IDS,
  VEHICLE_RESALE,
} from '@transport/shared';
import { money } from '../format';
import { useUi } from '../state/store';

export function HelpTab() {
  const slots = useUi((s) => s.view?.game.settings.actionSlots ?? 5);
  return (
    <section className="panel-section help">
      <h3>Zo werkt het</h3>
      <h4>Beurten en acties</h4>
      <p>
        Iedere speler heeft per beurt <strong>{slots} acties</strong> (actieslots). Op het vaste tijdstip worden de acties van alle spelers tegelijk
        uitgevoerd: eerst slot 1 van iedereen, dan slot 2, enzovoort. Tot dat moment kun je je acties aanpassen en herschikken.
      </p>
      <ul>
        <li>
          <strong>Elk stuk</strong> weg, spoor of kanaal (van een tegel naar de volgende) kost 1 actie. Een route van 8 stukken kost dus 8 acties: kies
          waar je je acties aan besteedt en bouw lange verbindingen over meerdere beurten.
        </li>
        <li>Een station of haven bouwen kost 1 actie, voertuigen inzetten of verkopen ook.</li>
        <li>
          <strong>Lenen, aflossen en bieden</strong> op aandelen kosten géén actie (tabblad Beurs).
        </li>
      </ul>
      <h4>Bouwen</h4>
      <ul>
        <li>
          Kies Weg, Spoor of Kanaal en klik op het begin. Beweeg dan de muis over de tegels waar de route moet komen en klik op het eind (terug
          bewegen haalt stukken weg). Op een telefoon: tik op het eind voor een rechte lijn, of sleep vanaf het beginpunt. De route komt meteen in je
          vrije slots.
        </li>
        <li>
          {TRANSPORT.road.name} ({money(TRANSPORT.road.edgeCost)}), {TRANSPORT.rail.name.toLowerCase()} ({money(TRANSPORT.rail.edgeCost)}) en{' '}
          {TRANSPORT.canal.name.toLowerCase()} ({money(TRANSPORT.canal.edgeCost)}) per stuk op vlak land. Bos, heuvels, bruggen en tunnels zijn
          duurder.
        </li>
        <li>
          Een station bedient alleen wat er <strong>direct naast</strong> ligt: {STATIONS.road.name.toLowerCase()} en treinstation{' '}
          {STATIONS.rail.radius} tegel, haven {STATIONS.water.radius} tegels. Je moet industrieën dus echt met elkaar verbinden.
        </li>
        <li>Een laadpunt of treinstation hoort op of direct naast je weg of spoor te staan; dan is het daarmee verbonden.</li>
        <li>Stadsstraten zijn openbaar: vrachtwagens en bussen van iedereen mogen erover. Schepen varen gratis over open water.</li>
      </ul>
      <h4>Conflicten</h4>
      <ul>
        <li>Willen twee spelers op dezelfde tegel bouwen, dan krijgt degene met het <strong>laagste slot</strong> de tegel. Het stuk van de ander mislukt.</li>
        <li>Hebben ze het <strong>hetzelfde slot</strong> gekozen, dan delen ze de tegel: beide spelers mogen er hun weg of spoor gebruiken.</li>
        <li>Op tegels van een ander kun je later niet meer bouwen. Schuin kruisen zonder kruising mag niet.</li>
      </ul>
      <h4>Industrieën en steden</h4>
      <ul>
        <li>Grondstoffen (graan, hout, kolen, erts, olie, steen) gaan naar fabrieken; fabrieken maken producten.</li>
        <li>
          <strong>Steden</strong> vragen producten (voedsel en 2–3 andere, zie de iconen bij de naam) én willen met elkaar verbonden worden: elke
          stad heeft passagiers (👥) die naar een andere stad willen. Vervoer ze met bussen, passagierstreinen of veerboten tussen stations bij
          twee steden ({money(CARGO.passengers.price)} per passagier per tegel, in beide richtingen).
        </li>
        <li>
          Opbrengst = hoeveelheid × prijs × marktprijs × <strong>hemelsbrede afstand</strong> tussen herkomst en bestemming. Je verdient pas als een
          voertuig aankomt.
        </li>
        <li>Steden betalen boven hun vraag maar {Math.round(OVERSUPPLY_PRICE_FACTOR * 100)}% van de prijs. Marktprijzen dalen als iedereen hetzelfde levert.</li>
        <li>Voertuigen, stations en infrastructuur kosten elke beurt onderhoud. Te veel voertuigen? Verkoop ze (via de stationsinfo) voor {Math.round(VEHICLE_RESALE * 100)}% van de prijs.</li>
      </ul>
      <h4>Hoofdkantoor</h4>
      <p>
        Leveringen tussen twee stations die allebei binnen <strong>{HQ_BONUS.radius} tegels</strong> van je hoofdkantoor liggen, leveren{' '}
        <strong>{Math.round(HQ_BONUS.bonus * 100)}% extra</strong> op. Het gebied zie je als gestippeld vierkant op de kaart. Begin dus dicht bij huis.
      </p>
      <h4>Beurs</h4>
      <ul>
        <li>
          Lenen in stappen van {money(LOANS.step)}, tot {money(LOANS.base)} plus de helft van de boekwaarde van je bezit. Rente:{' '}
          {Math.round(LOANS.rate * 100)}% per beurt.
        </li>
        <li>
          Na beurt {AUCTIONS.startAfterTurn} lopen er steeds {AUCTIONS.maxOpen} veilingen tegelijk, elk voor een aandeel (10%) in een industrie;
          als er één is afgelopen, komt er een nieuwe bij. Een bod blijft staan tot iemand hoger biedt; staat het een hele beurt als hoogste, dan is
          het aandeel van jou.
        </li>
        <li>
          Per aandeel krijg je {Math.round(AUCTIONS.tollPerShare * 100)}% van wat anderen met vracht van die industrie verdienen. Met{' '}
          {AUCTIONS.majority} aandelen mogen alleen jij en je bondgenoten er laden.
        </li>
      </ul>
      <h4>Allianties</h4>
      <ul>
        <li>Stel via het tabblad Spelers een alliantie voor. Bondgenoten mogen elkaars wegen, sporen, kanalen en stations gebruiken en erop aansluiten.</li>
        <li>Voor de conflictregels maakt een alliantie niets uit: ook tussen bondgenoten wint het laagste slot.</li>
        <li>Verlaat je de alliantie, dan stoppen jouw voertuigen op het netwerk van je oud-bondgenoten.</li>
      </ul>
      <h4>Voertuigen</h4>
      <table className="flows">
        <thead>
          <tr>
            <th>Voertuig</th>
            <th>Lading</th>
            <th>Tegels/beurt</th>
            <th>Prijs</th>
          </tr>
        </thead>
        <tbody>
          {VEHICLE_IDS.map((id) => (
            <tr key={id}>
              <td>
                {VEHICLES[id].icon} {VEHICLES[id].name}
              </td>
              <td>
                {VEHICLES[id].capacity} {VEHICLES[id].carries === 'passengers' ? '👥' : 'ton'}
              </td>
              <td>{VEHICLES[id].speed}</td>
              <td>{money(VEHICLES[id].price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Een beurt wordt gesimuleerd in {TICKS_PER_TURN} stappen. Bediening: slepen/vegen = kaart verschuiven, knijpen of scrollen = zoomen, tikken = kiezen.</p>
    </section>
  );
}
