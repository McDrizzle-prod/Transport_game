# Spelregels

Alle getallen hieronder komen uit [`shared/src/config.ts`](../shared/src/config.ts) en zijn daar aan te passen.

## Doel

Bouw het meest winstgevende transportbedrijf. Verbind industrieën met elkaar en met steden, zodat grondstoffen
fabrieken bereiken en producten de steden, en verbind steden met elkaar voor passagiers. (Een eindvoorwaarde, met
schulden en aandelen van bedrijven, staat op de [roadmap](ROADMAP.md).)

## Opzet

- De host maakt een spel: kaartgrootte (48, 64 of 96 tegels in het vierkant), maximaal aantal spelers, het aantal
  **acties per beurt** (standaard 5, van 3 tot 20), startkapitaal (standaard **€ 1.500.000**) en het moment van
  uitvoeren.
- Spelers doen mee via de uitnodigingslink of de spelcode, met een bedrijfsnaam en een **pincode** (4 tot 8
  cijfers). Met naam en pincode speel je verder op een ander apparaat of via een nieuwe link van de host.
- Iedere speler plaatst een **hoofdkantoor** op een vrije tegel, minstens **6 tegels** (in beide richtingen) van
  andere hoofdkantoren. Daarna start de host het spel. Wie later instapt, plaatst zijn hoofdkantoor bij binnenkomst.

## Beurten

- Een beurt wordt uitgevoerd op het ingestelde moment: **elke dag om een vast tijdstip** (in de tijdzone van de
  host), **elke N minuten** of **handmatig** door de host. Optioneel ook zodra alle spelers op "klaar" staan.
- Tot dat moment plan je je acties en kun je ze aanpassen; ze worden direct op de server bewaard. De acties van
  anderen zie je pas na de uitvoering.

## Acties en actieslots

Je hebt per beurt een vast aantal actieslots (standaard 5). Bij de uitvoering gaat **slot 1 van alle spelers
tegelijk**, dan slot 2, enzovoort. Binnen één slot worden eerst alle bouwacties uitgevoerd en daarna de
voertuig-acties. De volgorde is dus belangrijk:

- Bouw eerst je weg en stations en zet daarna voertuigen in. Andersom mislukt het kopen van de voertuigen, omdat de
  stations dan nog niet bestaan of nog niet verbonden zijn.
- Zet bouwacties waar je concurrentie verwacht zo vroeg mogelijk (zie Conflicten).

### Wat kost een actie

| Actie | Kost | Wat het doet |
| --- | --- | --- |
| **Een stuk weg / spoor / kanaal** | 1 actie per stuk | Eén stuk van een tegel naar een aangrenzende tegel (ook schuin). Een route van 8 stukken kost dus 8 acties. Stukken die al bestaan (je eigen netwerk, stadsstraten, open water) kosten niets. |
| **Station bouwen** | 1 actie | Laadpunt (voor vrachtwagens en bussen), treinstation of haven. |
| **Voertuigen inzetten** | 1 actie | 1–5 voertuigen tussen twee stations van jou (of een bondgenoot) die via je netwerk verbonden zijn. Ze vormen samen een lijn. |
| **Voertuigen verkopen** | 1 actie | Verkoop voertuigen van een lijn voor 50% van de nieuwprijs (via de info van een station). |
| **Lenen / aflossen / bieden** | geen actie | Gaat direct in, via het tabblad Beurs. |

**Zo plan je een route:** kies Weg, Spoor of Kanaal en tik op punt A (het begin) en daarna op punt B.

- De route loopt in een **rechte lijn** van A naar B (schuine stukken tellen als één stuk), alleen om een
  obstakel heen als er iets in de weg ligt; dan meldt het spel dat. Met een muis zie je vooraf gestippeld waar het
  volgende stuk komt.
- Na punt B **staat de route vast**: je ziet de route, de punten A en B, het aantal acties en de kosten, en tikken op
  de kaart verandert niets meer. Zo kan een tik net naast het vinkje geen extra spoor opleveren.
- Wil je een bocht? Tik op **＋** en dan op het volgende punt: de route loopt recht van punt naar punt. Met ＋ actief
  kun je ook op de route zelf tikken om terug te gaan naar dat punt. ↶ haalt het laatste punt weg.
- Klopt de ligging? Tik op het **groene vinkje ✓**. Pas dan komen de stukken in je actieslots (vink vooraf aan of je
  bij A en/of B een station wilt; elk station is een extra actie).

In de lijst met acties staat een route als één regel (bijv. "slot 2–9"), die je kunt openklappen of in één keer kunt
verwijderen.

### Wachtrij voor de volgende beurten

Past een route (of een andere actie) niet meer in de vrije slots van deze beurt, dan gaat de rest in de
**wachtrij**. Na elke uitgevoerde beurt vullen de eerste acties uit de wachtrij vanzelf de slots van de nieuwe
beurt, ook als je zelf niet online bent. Een spoor van 20 stukken met 5 acties per beurt wordt zo in 4 beurten
gebouwd: 5 stukken nu, de andere 15 in de wachtrij (5 per beurt).

- De wachtrij staat in het tabblad Acties onder je slots. Per regel zie je in welke beurt die acties aan de beurt
  zijn (bijv. "B8–10"), wat ze ongeveer kosten en of er inmiddels iets in de weg ligt (⚠, bijv. een tegel die een
  ander al heeft).
- Je kunt de volgorde veranderen (▲▼, per route of actie), routes per stuk bekijken en acties of hele routes
  weghalen. Heb je deze beurt nog vrije slots, dan haal je met **⤴ naar deze beurt** de eerste acties naar voren.
- Op de kaart staat de wachtrij als dunne stippellijn in je kleur.
- Is een actie niet meer mogelijk als hij aan de beurt is, dan mislukt hij gewoon (en kost hij niets); het rapport
  zegt waarom.

## Conflicten

Bouwen gebeurt per **tegel**. Wie een vrije tegel claimt, wordt eigenaar; op een tegel van een ander kun je niet
bouwen.

- **Verschillende slots**: de speler met het **laagste slot** krijgt de tegel. Het stuk van de ander dat over die
  tegel gaat, mislukt (en kost niets). In het rapport staat bijvoorbeeld:
  *"✖ Tegel (21, 9) al van Konkurrent BV (beurt 1, slot 1)"*.
- **Zelfde slot**: beide spelers krijgen de tegel. Ieder legt er zijn eigen weg of spoor; de tegel is gedeeld
  en beiden kunnen hem gebruiken. Leggen ze precies hetzelfde stuk, dan is dat stuk van allebei.
- **Twee stations van verschillend type** op dezelfde tegel in hetzelfde slot: beide worden geweigerd. Hetzelfde
  type: één gedeeld station.
- Schuine stukken mogen elkaar niet kruisen zonder kruising (anders zou je een andermans route "door" kunnen).
- Kruisingen met je **eigen** netwerk mogen wel: je weg kan je eigen spoor kruisen (overweg) en routes van
  hetzelfde type vormen een splitsing.
- Allianties veranderen niets aan de conflictregels.

Omdat elk stuk een eigen slot heeft, telt per tegel het slot van het stuk dat de tegel als eerste claimt.

## Netwerk, terrein en kosten

Kosten per stuk op vlak gras (een schuin stuk kost √2 ≈ 1,41 keer zoveel):

| | Bouwen | Onderhoud per beurt |
| --- | --- | --- |
| Weg | € 2.500 | € 25 |
| Spoor | € 6.000 | € 60 |
| Kanaal | € 20.000 | € 100 |

Terreinfactor: zand ×1,2 · bos ×1,5 · heuvels ×2,2 · bergen ×4 (tunnel, niet voor kanalen) · water ×6 (brug).
Kanalen over open water zijn gratis: schepen varen daar al.

- **Stadsstraten** zijn openbaar: vrachtwagens en bussen van iedereen mogen erover rijden.
- **Schepen** varen vrij over open water; kanalen (van jou of een bondgenoot) verbinden water over land.
- Bruggen hinderen schepen niet.

## Stations

| Station | Kosten | Onderhoud | Bereik |
| --- | --- | --- | --- |
| 🚏 Laadpunt | € 30.000 | € 1.000 | 1 tegel |
| 🚉 Treinstation | € 90.000 | € 3.000 | 1 tegel |
| ⚓ Haven | € 100.000 | € 3.000 | 2 tegels, moet aan water liggen |

Een station bedient alleen de industrieën en steden waarvan een tegel **direct naast** het station ligt (binnen
het bereik, in een vierkant rond het station). Tussen twee industrieën liggen altijd minstens 2 tegels, dus één
station kan nooit twee industrieën tegelijk bedienen: je moet echt een verbinding bouwen. Stations zijn van de bouwer;
gedeelde stations van allebei.

Een laadpunt of treinstation is verbonden met je weg of spoor als het erop staat of er **direct naast** ligt (ook
schuin); een laadpunt naast een stadsstraat is verbonden met de straten van die stad. Het station-gereedschap laat
bij het kiezen van een plek zien of dat zo is. Havens liggen altijd aan het water en zijn dus altijd bereikbaar.

## Overslag

Vracht mag onderweg overstappen op een andere lijn. Voorbeeld: een vrachtwagen haalt olie op bij een oliebron en
brengt die naar een laadpunt bij een haven; een schip vaart de olie naar een andere haven; een trein brengt hem van
een station bij die haven naar de raffinaderij.

- **Binnen bereik**: de stations moeten binnen het bereik van elkaar liggen. Voor een laadpunt en een treinstation
  is dat direct naast elkaar (1 tegel), bij een haven tot **2 tegels** van de haven. Overstappen op hetzelfde
  station (bijv. van de ene vrachtwagenlijn op de andere) kan ook. Op de kaart zie je zo'n koppeling als
  stippellijn met ⇄; de stationsinfo en het station-gereedschap noemen de stations waarmee overslag kan.
- **Wanneer**: komt vracht aan bij een station waar niemand die vracht wil, dan gaat ze naar het station (dat
  station zelf of een station binnen bereik) vanwaar een lijn haar het snelst bij een klant brengt. Vracht gaat
  nooit terug naar een station waar ze al is geweest. Kan ze nergens heen, dan laadt de lijn die vracht ook niet
  in: je vrachtwagens nemen olie dus pas mee als het schip er ook is.
- **Van wie**: alleen je eigen lijnen en die van bondgenoten nemen overgeslagen vracht over.
- **Geld**: de opbrengst wordt berekend zoals altijd (hemelsbrede afstand van de industrie tot de klant) en betaald
  als de vracht bij de klant aankomt. Elke lijn van de reis krijgt een deel, naar verhouding van de afstand tussen
  haar twee stations. De hoofdkantoorbonus en de tol aan aandeelhouders gelden per lijn.
- **Passagiers** reizen altijd rechtstreeks tussen twee steden; zij stappen niet over.

Bij het inzetten van voertuigen rekent het spel de overslag mee: je ziet waar de vracht naartoe gaat (⇄ via welke
stations), welk deel van de opbrengst deze lijn krijgt en hoeveel vracht andere lijnen aanleveren. In het rapport
staat per lijn hoeveel er is overgeslagen.

## Productieketens

| Industrie | Levert | Heeft nodig |
| --- | --- | --- |
| Boerderij | 🌾 Graan (40–80 per beurt) | – |
| Houtvesterij | 🪵 Boomstammen (40–80) | – |
| Kolenmijn | ⚫ Steenkool (50–80) | – |
| IJzerertsmijn | 🟠 IJzererts (50–80) | – |
| Oliebron | 🛢️ Ruwe olie (40–70) | – |
| Steengroeve | 🪨 Steen (40–70) | – |
| Voedselfabriek | 🥫 Voedsel | Graan |
| Zagerij | 🟫 Planken | Boomstammen |
| Staalfabriek | 🔩 Staal | Steenkool + IJzererts |
| Raffinaderij | ⛽ Brandstof | Ruwe olie |
| Bouwmaterialenfabriek | 🧱 Bouwmaterialen | Steen |
| Gereedschapsfabriek | 🔧 Gereedschap | Planken |
| Goederenfabriek | 📦 Goederen | Staal + Planken |

Op de kaart staat onder elke industrie wat erin gaat en wat eruit komt (bijv. 🌾 → 🥫), en bij grondstoffen
hoeveel er per beurt wordt geproduceerd.

Fabrieken verwerken maximaal 120 eenheden per beurt en produceren alleen als ze grondstoffen krijgen. Wat ze maken
kan door iedereen met een station ernaast worden opgehaald (tenzij iemand de meerderheid van de aandelen heeft,
zie Beurs).

Liggen er meerdere stations met actieve lijnen bij één industrie, dan wordt de productie eerlijk over die stations
verdeeld.

## Steden

Steden hebben twee rollen (op de kaart staan ze onder de naam: de gevraagde producten en het aantal passagiers):

1. **Ze vragen producten**: altijd voedsel en daarnaast 2–3 van: goederen, brandstof, gereedschap,
   bouwmaterialen. Hoeveel ze per beurt willen hangt af van het aantal inwoners. Lever je meer dan de vraag, dan
   krijg je voor het meerdere maar 40% van de prijs.
2. **Ze willen met andere steden verbonden worden**: per 40 inwoners wil elke beurt 1 passagier naar een andere
   stad (een stad van 2.000 inwoners: 50 passagiers per beurt). Wachtende passagiers stapelen op tot 3 beurten.
   Vervoer ze met een 🚌 bus, 🚄 passagierstrein of ⛴️ veerboot tussen een station bij de ene stad en een station bij
   een andere stad. Passagiers reizen in beide richtingen en leveren **€ 16 per passagier per tegel** afstand
   tussen de twee steden op (een vaste prijs, los van de markt).

Vrachtvoertuigen vervoeren geen passagiers en passagiersvoertuigen geen vracht; een vrachtlijn en een
passagierslijn tussen dezelfde stations zijn aparte lijnen.

## Voertuigen

| Voertuig | Lading | Snelheid (tegels per beurt) | Prijs | Onderhoud per beurt |
| --- | --- | --- | --- | --- |
| 🚚 Vrachtwagen | 20 ton | 40 | € 45.000 | € 4.000 |
| 🚛 Zware vrachtwagen | 32 ton | 32 | € 75.000 | € 6.000 |
| 🚌 Bus | 25 passagiers | 44 | € 50.000 | € 4.000 |
| 🚂 Stoomtrein | 90 ton | 56 | € 220.000 | € 15.000 |
| 🚆 Dieseltrein | 140 ton | 88 | € 380.000 | € 24.000 |
| 🚄 Passagierstrein | 120 passagiers | 80 | € 280.000 | € 18.000 |
| 🛥️ Binnenvaartschip | 150 ton | 22 | € 140.000 | € 9.000 |
| 🚢 Vrachtschip | 280 ton | 30 | € 260.000 | € 16.000 |
| ⛴️ Veerboot | 120 passagiers | 30 | € 140.000 | € 9.000 |

Een beurt wordt in 40 stappen gesimuleerd. Een voertuig laadt bij het ene station wat het andere station accepteert,
rijdt met zijn eigen snelheid en levert af bij aankomst. Daarna laadt het voor de terugweg (als er iets terug te
vervoeren valt). Voertuigen zijn aan het eind van een beurt gewoon onderweg en rijden de volgende beurt verder.
Meerdere voertuigen op één lijn vertrekken gespreid.

Kies je bij het inzetten eerst een voertuig (bijv. een vrachtwagen), dan kun je alleen stations van dat soort kiezen
(laadpunten); tik je op een ander soort station, dan legt het spel uit waarom dat niet kan. Kies je eerst een station,
dan past het soort voertuig zich aan (bijv. treinstation → trein). Een tik op het icoon van een station telt, ook als
je net naast de tegel tikt.

## Opbrengst

Bij aflevering krijgt de eigenaar van het voertuig:

```
opbrengst = hoeveelheid × basisprijs × marktprijs × afstand  (+ 25% hoofdkantoorbonus)  (− tol aan aandeelhouders)
```

- **afstand** = hemelsbrede afstand in tegels tussen het midden van de industrie waar de vracht vandaan kwam (bij
  passagiers: de stad van vertrek) en het midden van de bestemming (industrie of stad). Een omweg levert dus niets
  extra op, een lange verbinding wel.
- **basisprijs** per ton per tegel: grondstoffen € 28–36, producten € 48–85 (zie het tabblad Markt), passagiers € 16.
- Voorbeeld: 20 ton graan (€ 32) over 22 tegels bij marktprijs ×1,00 = 20 × 32 × 22 = **€ 14.080**.
- Bij **overslag** wordt dit bedrag bij aankomst bij de klant verdeeld over de lijnen van de reis, naar de afstand
  die elke lijn aflegt (zie Overslag).

Het spel toont deze berekening vooraf bij het inzetten van voertuigen: verwachte vracht per beurt, opbrengst,
onderhoud, netto per beurt en terugverdientijd (inclusief bonus en tol).

## Hoofdkantoor

Om je activiteiten (eerst) in één deel van de kaart te concentreren: leveringen op een lijn waarvan **beide
stations binnen 10 tegels** (in beide richtingen) van je hoofdkantoor liggen, leveren **25% extra** op. Het
bonusgebied staat als gestippeld vierkant om je hoofdkantoor op de kaart.

## Markt

Elke goedsoort heeft een marktprijs (×0,50 tot ×1,60, start ×1,00). Na elke beurt beweegt die richting een
doelprijs: `1,30 − 0,55 × (geleverd op de hele kaart / vraag op de hele kaart)`. Wordt een goed weinig geleverd,
dan stijgt de prijs; leveren veel spelers hetzelfde, dan daalt hij. Per beurt wordt 35% van het verschil
overbrugd, met een kleine willekeurige schommeling. Passagiers hebben een vaste prijs.

## Kosten en geld

Na de simulatie betaal je onderhoud voor voertuigen, stations en infrastructuur (gedeelde infrastructuur betaal je
samen) en rente over je leningen. Je saldo kan negatief worden; dan mislukken bouw- en koopacties tot je weer geld
hebt. Leen dan bij, verkoop voertuigen of wacht op opbrengsten.

## Beurs (vrije acties)

### Leningen

- Lenen en aflossen in stappen van **€ 250.000**, op elk moment (kost geen actie en gaat direct in).
- Rente: **2% per beurt** over je schuld, aan het eind van elke beurt.
- Kredietlimiet: **€ 500.000 + 50% van de boekwaarde** van je bezit. De boekwaarde is 50% van wat je voertuigen,
  stations en infrastructuur hebben gekost.

### Veilingen van aandelen in industrieën

- Elke industrie heeft **10 aandelen** van 10%, aanvankelijk allemaal van de bank.
- **Na beurt 10** lopen er steeds **3 veilingen tegelijk**, elk voor één aandeel van een willekeurige industrie.
  Pas als een veiling is afgelopen (verkocht of vervallen), komt er een nieuwe bij, voor een andere industrie. De
  startprijs hangt af van wat de industrie produceert.
- Bieden kost geen actie. Een nieuw bod moet minstens **5% hoger** zijn dan het hoogste bod. Het geld van het
  hoogste bod wordt direct gereserveerd; wie wordt overboden, krijgt zijn geld meteen terug.
- **Een bod moet een hele beurt het hoogste blijven**: een bod uit beurt T wint aan het eind van beurt T+1 als
  niemand meer heeft geboden. Zo heeft iedereen minstens één volledige beurt om te reageren.
- Een veiling zonder bod vervalt na 3 beurten; het aandeel blijft dan bij de bank (en kan later terugkomen).
- **Wat een aandeel oplevert**: per aandeel krijg je **3%** van de opbrengst die *andere* spelers maken met vracht
  van die industrie (zij dragen dat af; met 2 aandelen dus 6%).
- **Meerderheid (6 of meer aandelen)**: alleen jij en je bondgenoten mogen nog vracht laden bij die industrie.
- **Op de kaart**: 🔨 = er loopt een veiling, een groene gloed met bijv. "2/10" = jouw aandelen, 🔒 = een ander heeft
  de meerderheid (jij mag er niet laden). Klik je in het tabblad Beurs op een industrie, dan springt de kaart
  ernaartoe en licht de industrie geel op.

## Allianties

- Stel in het tabblad **Spelers** een alliantie voor; de ander accepteert of weigert. Een speler zit in hoogstens
  één alliantie; een bestaande alliantie kan nieuwe leden uitnodigen.
- Bondgenoten mogen elkaars **wegen, sporen, kanalen en stations** gebruiken en mogen hun eigen routes op die van een
  bondgenoot laten aansluiten.
- Wie de alliantie verlaat, verliest die toegang meteen: voertuigen die over het netwerk van een oud-bondgenoot
  reden, komen stil te staan tot er weer een route is.
