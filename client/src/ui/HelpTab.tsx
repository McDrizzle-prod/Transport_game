// Short explanation of the rules.
import { ACTION_SLOTS, OVERSUPPLY_PRICE_FACTOR, STATIONS, TICKS_PER_TURN, TRANSPORT, VEHICLES, VEHICLE_IDS } from '@transport/shared';
import { money } from '../format';

export function HelpTab() {
  return (
    <section className="panel-section help">
      <h3>Zo werkt het</h3>
      <h4>Beurten en actieslots</h4>
      <p>
        Iedere speler heeft per beurt {ACTION_SLOTS} actieslots. Op het vaste tijdstip worden de acties van alle spelers tegelijk uitgevoerd:
        eerst slot 1 van iedereen, dan slot 2, enzovoort. Tot dat moment kun je je acties aanpassen en herschikken.
      </p>
      <h4>Conflicten</h4>
      <ul>
        <li>Willen twee spelers op dezelfde tegel bouwen, dan krijgt degene met het <strong>laagste slot</strong> de tegel. De ander bouwt de rest van de route, maar niet over die tegel.</li>
        <li>Hebben ze het <strong>hetzelfde slot</strong> gekozen, dan delen ze de tegel: beide spelers mogen er hun weg of spoor gebruiken.</li>
        <li>Op tegels van een ander kun je later niet meer bouwen. Schuin kruisen zonder kruising mag niet.</li>
      </ul>
      <h4>Verbindingen</h4>
      <ul>
        <li>
          {TRANSPORT.road.name} ({money(TRANSPORT.road.edgeCost)}), {TRANSPORT.rail.name.toLowerCase()} ({money(TRANSPORT.rail.edgeCost)}) en{' '}
          {TRANSPORT.canal.name.toLowerCase()} ({money(TRANSPORT.canal.edgeCost)}) per stuk op vlak land. Bos, heuvels, bruggen en tunnels zijn
          duurder.
        </li>
        <li>
          Een station bedient industrieën en steden binnen zijn bereik: {STATIONS.road.name.toLowerCase()} {STATIONS.road.radius}, treinstation{' '}
          {STATIONS.rail.radius}, haven {STATIONS.water.radius} tegels.
        </li>
        <li>Stadsstraten zijn openbaar: vrachtwagens van iedereen mogen erover.</li>
        <li>Schepen varen gratis over open water; een kanaal verbindt water over land.</li>
      </ul>
      <h4>Productieketens en geld</h4>
      <ul>
        <li>Grondstoffen (graan, hout, kolen, erts, olie, steen) gaan naar fabrieken; fabrieken maken producten voor steden.</li>
        <li>
          Opbrengst = hoeveelheid × prijs per ton per tegel × marktprijs × <strong>hemelsbrede afstand</strong> tussen de industrie van herkomst en de
          bestemming.
        </li>
        <li>Je verdient pas als een voertuig aankomt. Langzame schepen doen soms meerdere beurten over één rit.</li>
        <li>Steden betalen boven hun vraag maar {Math.round(OVERSUPPLY_PRICE_FACTOR * 100)}% van de prijs. Marktprijzen dalen als iedereen hetzelfde levert.</li>
        <li>Voertuigen, stations en infrastructuur kosten elke beurt onderhoud.</li>
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
              <td>{VEHICLES[id].capacity}</td>
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
