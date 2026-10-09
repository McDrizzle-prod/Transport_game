# Roadmap / TODO

## Stand van zaken van de wensenlijst

| Wens | Status in deze versie |
| --- | --- |
| Kaart met industrieën (productieketens) en steden, hoofdkantoor plaatsen | ✅ |
| Actieslots, gelijktijdig uitgevoerd op een vast tijdstip per dag | ✅ standaard 5, instelbaar 3–20 (ook: elke N minuten of handmatig) |
| Conflictregel: laagste slot wint, zelfde slot = gedeeld gebruik | ✅ per tegel, zichtbaar in rapport en afspeelfunctie |
| Wegen, sporen, waterwegen + voertuigen tussen twee industrieën | ✅ (plus stations, havens, kanalen, voertuigen verkopen) |
| Goederen uitwisselen bij stations aan twee industrieën | ✅ |
| *Nice to have:* opbrengst op basis van afstand | ✅ incl. schatting vooraf |
| Variërende snelheden: pas geld bij aankomst | ✅ |
| Marktmechanisme (vraag en aanbod) | 🟡 basisversie: prijs per goed op de hele kaart + verzadiging per stad |
| Allianties: elkaars netwerk gebruiken | 🟡 basisversie: voorstellen/accepteren/verlaten, netwerk en stations delen |
| **Testronde 1:** steden vragen producten én willen onderling verbonden worden (passagiers) | ✅ bus, passagierstrein, veerboot |
| **Testronde 1:** routegereedschap stopt na het tweede punt | ✅ route gaat direct in de vrije slots |
| **Testronde 1:** station kiezen bij voertuigen | ✅ tik op of naast een station; het soort voertuig past zich aan |
| **Testronde 1:** bonus in een straal rond het hoofdkantoor | ✅ +25% binnen 10 tegels |
| **Testronde 1:** lenen en bieden kosten geen actieslot | ✅ tabblad Beurs |
| **Testronde 1:** na 10 beurten elke beurt aandelen (10%) van 3 industrieën in de veiling; een bod moet een hele beurt het hoogste blijven | ✅ |
| **Testronde 1:** kleiner bereik van stations | ✅ 1 tegel (haven 2); industrieën liggen verder uit elkaar |
| **Testronde 1:** 1 actie per tegel weg/spoor en per station | ✅ |
| **Testronde 2:** twee laadpunten kiezen voor vrachtwagens lukte niet (havens wel) | ✅ zie hieronder |
| **Testronde 2:** soms stukken weg op tegels waar de muis niet was | ✅ de route volgt nu de muis |
| **Testronde 2:** maximaal 3 veilingen tegelijk; pas na afloop een nieuwe | ✅ |
| **Testronde 2:** eigen aandelen zichtbaar op de kaart | ✅ groene gloed + "2/10"; ook 🔨 bij veilingen en 🔒 bij een meerderheid van een ander |
| **Testronde 2:** gele gloed bij het springen naar een industrie vanuit de veilingen | ✅ ook bij tegels uit het rapport |
| **Testronde 3:** nieuwe spelers landen op de meedoen-pagina, niet op de kaart | ✅ een spellink zonder bedrijf opent het meedoen-formulier; het startscherm begint met meedoen |
| **Testronde 3:** wegen op mobiel: punt A, punt B, voorbeeld, groen vinkje | ✅ voor muis én touch; slepen tekent niet meer (dat legde wegen waar je de kaart verschoof) |
| **Testronde 3:** meespelen buiten je wifi (tot 6 spelers) | ✅ `npm run online` (gratis Cloudflare-tunnel vanaf je eigen computer) + pincode om verder te spelen |
| Veilingen voor aandelen in industrieën (exclusief gebruik / winstdeling) | ✅ basisversie, zie hieronder |
| Schulden → gedwongen verkoop van eigen aandelen → laatste alliantie wint | 🟡 leningen zijn er; aandelen van bedrijven en het eindspel nog niet |

### Testronde 2: oorzaak van het laadpunt-probleem

Er speelden drie dingen tegelijk, die nu alle drie zijn opgelost:

1. Het station-gereedschap begon met **treinstation**; wie niet omschakelde, bouwde treinstations in plaats van
   laadpunten. Nu begint het met een laadpunt en onthoudt het je laatste keuze.
2. Een laadpunt **naast** de weg (in plaats van precies op het eind) was niet verbonden. Nu is een laadpunt of
   treinstation verbonden met een weg of spoor van jou die erop of direct naast ligt (havens liggen altijd aan het
   water, daarom werkten die wel).
3. Na het kiezen van een vrachtwagen werd een tik op een ander soort station stilletjes omgezet naar een ander
   voertuig. Nu blijft je keuze staan en legt het spel uit welk soort station nodig is. Ook telt een tik op het
   icoon van een station, ook als je net naast de tegel tikt, en staat er een duidelijke melding als al je slots
   vol zijn.

### Gemaakte keuzes bij testronde 1 (graag feedback)

- **"Aandelen van 3 bedrijven"** is gelezen als: aandelen van 3 *industrieën* (de veilingen uit de oorspronkelijke
  wensenlijst). Aandelen van spelersbedrijven horen bij het eindspel hieronder.
- **Wat een aandeel oplevert**: 3% per aandeel van wat *andere* spelers verdienen met vracht van die industrie, en
  bij 6 of meer aandelen bepaal je dat alleen jij en je bondgenoten er mogen laden. Beide getallen staan in
  `AUCTIONS` in `shared/src/config.ts`.
- **Een bod moet een hele beurt het hoogste blijven**: een bod uit beurt T wint aan het eind van beurt T+1. Zonder
  bod vervalt een veiling na 3 beurten. Er lopen steeds 3 veilingen tegelijk (testronde 2).
- **Geld voor een bod** wordt meteen gereserveerd, zodat niemand meer kan bieden dan hij heeft.
- **Hoofdkantoorbonus**: beide stations van een lijn moeten binnen 10 tegels van het hoofdkantoor liggen (Chebyshev,
  dus een vierkant van 21 × 21 tegels).
- **1 actie per tegel**: één stuk van tegel naar tegel is één actie; bestaande stukken (eigen netwerk, stadsstraten,
  open water) kosten niets. Omdat 5 acties dan weinig is, kan de host het aantal acties per beurt kiezen (3–20).
- **Passagiers**: 1 per 40 inwoners per beurt, vaste prijs € 16 per passagier per tegel tussen de twee steden.

---

## Volgende iteraties

### Aandelen van bedrijven en het eindspel

Bouwt voort op de leningen en de veilingen die er nu zijn.

- Elk bedrijf heeft **10 aandelen**; de oprichter begint met alle 10.
- **Kapitaal ophalen**: een speler zet eigen aandelen in de veiling (zelfde veilingsysteem als voor industrieën);
  de opbrengst gaat naar het bedrijf.
- **Dividend**: een deel van de winst per beurt gaat naar de aandeelhouders naar rato.
- **In nood**: schuld boven de kredietlimiet (bv. door rente of verliezen) → het bedrijf moet elke beurt aandelen
  veilen tot de schuld weer onder de limiet zit (minimumprijs = aandeel van de bedrijfswaarde).
- **Noodlening**: eindigt een beurt met een negatief saldo, dan volgt automatisch een dure lening.
- **Zeggenschap**: wie meer dan 50% van een bedrijf heeft, bepaalt mee. Voorstel: het bedrijf komt automatisch in
  de alliantie van de meerderheidseigenaar; de oprichter speelt door als junior-partner of valt af.
- **Einde van het spel**: zodra alle overgebleven bedrijven (direct of via meerderheidsaandelen) bij één alliantie
  horen, eindigt het spel en wint die alliantie. De server zet het spel dan op `finished` en toont een eindstand.

Technisch: `Player.shares`, veilingen met een `asset` (industrie of bedrijf) in plaats van alleen `industry`,
afhandeling in `closeAuctions`, grafiek van de bedrijfswaarde in het tabblad Beurs.

### Uitbreiding van de industrie-aandelen

- Keuze per industrie voor de meerderheidseigenaar: *exclusief* (zoals nu) of *tol* (iedereen mag laden maar betaalt
  een hoger percentage).
- Aandeelhouders kunnen investeren om de productie te verhogen.
- Aandelen onderling verkopen (niet alleen van de bank kopen).

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
- Steden groeien door leveringen en passagiers; industrieën groeien bij goede bediening (zoals in Transport Fever) of krimpen.
- Passagiers met een voorkeursbestemming (grote steden trekken meer) en post als extra lading.
- Grotere kaarten en een kaarteditor.

**Bediening**
- Een geplande route in één keer verplaatsen naar andere slots (nu per stuk met ▲/▼).
- Een al geplande route achteraf aanpassen (nu: verwijderen en opnieuw tekenen).

## Techniek

- **Vast online** (altijd bereikbaar, ook als de computer van de host uit staat): het spel op een kleine server in
  de cloud zetten, bv. een VPS of Fly.io/Railway met een blijvende schijf voor `DATA_DIR`, of een eigen domein met
  een vaste Cloudflare-tunnel. Dat vraagt een account en een paar euro per maand; graag samen kiezen wanneer de
  playtests daarom vragen.
- **Accounts** (bv. e-mail-link) in plaats van alleen een token in de browser, zodat je op elk apparaat verder kunt.
- **Pushmeldingen** (Web Push) bij een uitgevoerde beurt, een alliantievoorstel, een overboden bod of een aflopende
  deadline.
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
- De spelbalans is met simulaties ingesteld, niet met echte spelers. Met 5 acties per beurt duurt een eerste
  verbinding een paar beurten; voor een snellere start kan de host meer acties kiezen.
- Spellen uit de vorige versie kunnen worden geladen, maar zijn gemaakt met de oude kaart (industrieën dichter
  bij elkaar); begin voor de nieuwe regels een nieuw spel.
- Na de uitvoering zijn de acties van iedereen in het rapport te zien (bewust: zo zie je wat er gebeurde).
- Spelers identificeren zich met een token in de browser, en met naam + pincode op een ander apparaat. Spelers
  die meededen vóór de pincode bestond, stellen er een in via het tabblad Spelers.
- `npm run online` geeft elke keer een nieuwe link en werkt alleen als de computer van de host aan staat. Voor een
  vaste link: zie *Vast online* bij Techniek.

## Open vragen voor de volgende iteratie

1. Klopt de lezing van "aandelen van 3 bedrijven" als aandelen van industrieën (zie hierboven)?
2. Winnaar alleen als laatste alliantie, of ook na een vast aantal beurten op bedrijfswaarde?
3. Mogen bondgenoten elkaar tol vragen, en wie bepaalt de hoogte?
4. Wat gebeurt er met een speler wiens bedrijf door een ander wordt overgenomen: speelt hij door (junior-partner) of
   valt hij af?
5. Is 25% binnen 10 tegels een goede hoofdkantoorbonus, of liever een kleinere straal / bonus die afneemt met de
   afstand?
