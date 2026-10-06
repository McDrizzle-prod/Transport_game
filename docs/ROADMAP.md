# Roadmap / TODO

## Stand van zaken van de wensenlijst

| Wens | Status in deze versie |
| --- | --- |
| Kaart met industrieën (productieketens) en steden, hoofdkantoor plaatsen | ✅ |
| 5 actieslots, gelijktijdig uitgevoerd op een vast tijdstip per dag | ✅ (ook: elke N minuten of handmatig) |
| Conflictregel: laagste slot wint, zelfde slot = gedeeld gebruik | ✅ per tegel, zichtbaar in rapport en afspeelfunctie |
| Wegen, sporen, waterwegen + voertuigen tussen twee industrieën | ✅ (plus stations, havens, kanalen, voertuigen verkopen) |
| Goederen uitwisselen bij stations aan twee industrieën | ✅ |
| *Nice to have:* opbrengst op basis van afstand | ✅ incl. schatting vooraf |
| Variërende snelheden: pas geld bij aankomst | ✅ |
| Marktmechanisme (vraag en aanbod) | 🟡 basisversie: prijs per goed op de hele kaart + verzadiging per stad |
| Allianties: elkaars netwerk gebruiken | 🟡 basisversie: voorstellen/accepteren/verlaten, netwerk en stations delen |
| Veilingen voor aandelen in industrieën | ⬜ ontwerpvoorstel hieronder |
| Schulden → gedwongen verkoop van eigen aandelen → laatste alliantie wint | ⬜ ontwerpvoorstel hieronder |

De laatste twee hangen sterk samen (beide draaien om aandelen, waarde en veilingen). Daarom stel ik voor ze samen
in drie iteraties te bouwen, in deze volgorde: eerst geld lenen, dan aandelen van bedrijven, dan aandelen van
industrieën. Elke stap is op zichzelf speelbaar.

---

## Iteratie 1 — Bedrijfswaarde, leningen en schuld

Fundament voor alles wat met aandelen te maken heeft.

- **Bedrijfswaarde** per beurt berekenen: geld + boekwaarde van infrastructuur, stations en voertuigen (bv. 50%
  van de aanschafprijs) − schuld. Tonen in het spelersoverzicht en als grafiekje.
- **Lenen en aflossen** in stappen van € 250.000, tot een kredietlimiet (bv. 50% van de bedrijfswaarde), met rente
  per beurt (bv. 2%). Rente en aflossing worden bij de uitvoering verrekend.
- **Noodlening**: eindigt een beurt met een negatief saldo, dan volgt automatisch een dure lening.
- **In nood**: schuld boven de kredietlimiet → status "in nood". In iteratie 2 leidt dat tot gedwongen verkoop
  van aandelen.

Technisch: `Company { loans: Loan[] }` in de spelstaat, rente in `chargeUpkeep`, waardeberekening in `economy.ts`.

## Iteratie 2 — Aandelen van bedrijven en het eindspel

- Elk bedrijf heeft **10 aandelen**; de oprichter begint met alle 10.
- **Kapitaal ophalen**: een speler zet eigen aandelen in de **veiling**; de opbrengst gaat naar het bedrijf.
  Past bij het spel met gelijktijdige beurten als **gesloten bod**: iedereen biedt tot het uitvoeringsmoment, de
  hoogste bieder wint (gelijk = verdeeld of oudste bod).
- **Dividend**: een deel van de winst per beurt gaat naar de aandeelhouders naar rato.
- **Gedwongen verkoop**: een bedrijf dat "in nood" is moet elke beurt aandelen veilen tot de schuld weer onder de
  limiet zit (minimumprijs = aandeel van de bedrijfswaarde).
- **Zeggenschap**: wie meer dan 50% van een bedrijf heeft, bepaalt mee. Voorstel: het bedrijf komt automatisch in
  de alliantie van de meerderheidseigenaar; de oprichter speelt door als junior-partner of valt af.
- **Einde van het spel**: zodra alle overgebleven bedrijven (direct of via meerderheidsaandelen) bij één alliantie
  horen, eindigt het spel en wint die alliantie. De server zet het spel dan op `finished` en toont een eindstand.

Technisch: `shares: Record<PlayerId, number>` per bedrijf, `Auction { asset, shares, minBid, bids, closesTurn }`,
afhandeling van veilingen in `resolveTurn` vóór slot 1 (zodat opgehaald geld in dezelfde beurt gebruikt kan
worden), nieuw tabblad "Beurs".

## Iteratie 3 — Aandelen in industrieën (veilingen)

- Elke industrie heeft 10 aandelen, aanvankelijk van "de bank". Regelmatig (bv. elke beurt één industrie) komen
  aandelen in de veiling, met hetzelfde gesloten-bod-systeem.
- **Meerderheid (≥ 6 aandelen)**: kies per industrie tussen
  - *exclusief gebruik*: alleen stations van jou en je bondgenoten mogen er laden; of
  - *tol*: andere vervoerders betalen een percentage van hun opbrengst uit vracht van deze industrie aan de
    aandeelhouders.
- **Minderheid**: dividend naar rato uit de waarde van wat de industrie die beurt afzette ("een graantje
  meepikken van andermans transport").
- Optioneel: aandeelhouders kunnen investeren om de productie te verhogen.

Technisch: `Industry.shares`, `Industry.policy`, aanpassing van de verdeling in `simulation.ts` (`pickup`) en van de
opbrengst bij aflevering.

---

## Verder uitbouwen van wat er al is

**Markt**
- Prijzen per stad/regio in plaats van alleen kaartbreed; vraag die groeit als een stad goed bevoorraad wordt.
- Gebeurtenissen (staking, hausse, slechte oogst) en een prijsprognose.
- Grafiek met prijsverloop per goed over meer beurten.

**Allianties**
- Instelbare tol of vergoeding voor het gebruik van het netwerk van een bondgenoot.
- Alliantiechat, gezamenlijke doelen, gezamenlijke stand.
- Vertrekken alleen bij de beurtwissel (nu: direct), zodat niemand vlak voor de uitvoering wisselt.
- Keuze of bondgenoten bij een conflict automatisch de tegel delen.

**Voertuigen en netwerk**
- Lijnen met meer dan twee stops; lijnen aanpassen; voertuigen tussen lijnen verplaatsen.
- Capaciteit en drukte: seinen/blokken op spoor, perrons per station, files.
- Slopen van infrastructuur; bruggen/tunnels over infrastructuur van anderen (tegen betaling).
- Nieuwe voertuigen per tijdperk, slijtage en vervanging.
- Wachten op volle lading als optie per lijn.

**Kaart, steden en industrieën**
- Steden groeien door leveringen; industrieën groeien bij goede bediening (zoals in Transport Fever) of krimpen.
- Een rol voor het **hoofdkantoor**, bijvoorbeeld een bouwstraal of korting in de buurt van het HQ.
- Grotere kaarten en een kaarteditor.

## Techniek

- **Accounts** (bv. e-mail-link) in plaats van alleen een token in de browser, zodat je op elk apparaat verder kunt.
- **Pushmeldingen** (Web Push) bij een uitgevoerde beurt, een alliantievoorstel of een aflopende deadline.
- **Native apps** voor iOS/Android door de webclient in [Capacitor](https://capacitorjs.com) te verpakken
  (`VITE_API_URL` wijst dan naar de server).
- **Database** (SQLite of PostgreSQL) in plaats van JSON-bestanden; back-ups.
- Alleen **wijzigingen** naar de clients sturen in plaats van de hele spelstaat (nu prima voor kleine groepen).
- Beheer voor de host: speler verwijderen, spel pauzeren, schema aanpassen, host overdragen, spel afsluiten.
- Computerspelers om alleen te kunnen oefenen.
- Engelse vertaling (alle teksten staan al bij elkaar in `client/src/i18n.ts` en `shared/src/config.ts`).
- Automatische controles bij elke push (GitHub Actions: typecheck, tests, build, e2e).

## Bekende beperkingen van de proof of concept

- Geen slopen, geen lijnen met meerdere stops, geen bewerking van bestaande lijnen.
- Het hoofdkantoor heeft nog geen spelinvloed.
- De spelbalans is met simulaties ingesteld, niet met echte spelers.
- Na de uitvoering zijn de acties van iedereen in het rapport te zien (bewust: zo zie je wat er gebeurde).
- Spelers identificeren zich met een token in de browser; wie dat kwijtraakt (andere browser, gewist geheugen),
  kan niet meer als dat bedrijf spelen.

## Open vragen voor de volgende iteratie

1. Moeten leningen, biedingen en aflossingen een actieslot kosten, of zijn het "vrije" acties naast de 5 slots?
2. Winnaar alleen als laatste alliantie, of ook na een vast aantal beurten op bedrijfswaarde?
3. Mogen bondgenoten elkaar tol vragen, en wie bepaalt de hoogte?
4. Wat gebeurt er met een speler wiens bedrijf door een ander wordt overgenomen: speelt hij door (junior-partner) of
   valt hij af?
5. Welke rol wil je het hoofdkantoor geven?
