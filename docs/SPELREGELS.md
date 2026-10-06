# Spelregels

Alle getallen hieronder komen uit [`shared/src/config.ts`](../shared/src/config.ts) en zijn daar aan te passen.

## Doel

Bouw het meest winstgevende transportbedrijf. Verbind industrieën met elkaar en met steden, zodat grondstoffen
fabrieken bereiken en producten de steden. (Een eindvoorwaarde, met schulden en aandelen, staat op de
[roadmap](ROADMAP.md).)

## Opzet

- De host maakt een spel: kaartgrootte (48, 64 of 96 tegels in het vierkant), maximaal aantal spelers,
  startkapitaal (standaard **€ 1.500.000**) en het moment van uitvoeren.
- Iedere speler plaatst een **hoofdkantoor** op een vrije tegel, minstens **6 tegels** (in beide richtingen) van
  andere hoofdkantoren. Daarna start de host het spel. Wie later instapt, plaatst zijn hoofdkantoor bij binnenkomst.

## Beurten

- Een beurt wordt uitgevoerd op het ingestelde moment: **elke dag om een vast tijdstip** (in de tijdzone van de
  host), **elke N minuten** of **handmatig** door de host. Optioneel ook zodra alle spelers op "klaar" staan.
- Tot dat moment plan je je acties en kun je ze aanpassen; ze worden direct op de server bewaard. De acties van
  anderen zie je pas na de uitvoering.

## De 5 actieslots

Je hebt per beurt 5 slots. Bij de uitvoering gaat **slot 1 van alle spelers tegelijk**, dan slot 2, tot en met
slot 5. Binnen één slot worden eerst alle bouwacties uitgevoerd en daarna de voertuig-acties. De volgorde is dus
belangrijk:

- Bouw eerst je weg met stations (slot 1) en zet daarna voertuigen in (slot 2). Andersom mislukt het kopen van de
  voertuigen, omdat de stations dan nog niet bestaan.
- Zet bouwacties waar je concurrentie verwacht zo vroeg mogelijk (zie Conflicten).

### Acties

| Actie | Wat het doet |
| --- | --- |
| **Weg / spoor / kanaal aanleggen** | Een route van maximaal 64 stukken. Tik begin, eventuele tussenpunten en eind; de planner kiest de goedkoopste route en hergebruikt je eigen netwerk gratis. Optioneel een station aan het begin en/of eind. |
| **Station bouwen** | Vrachtstation, treinstation of haven op een losse tegel. |
| **Voertuigen inzetten** | 1–5 voertuigen tussen twee stations van jou (of een bondgenoot) die via je netwerk verbonden zijn. Ze vormen samen een lijn. |
| **Voertuigen verkopen** | Verkoop voertuigen van een lijn voor 50% van de nieuwprijs (via de info van een station). |

## Conflicten

Bouwen gebeurt per **tegel**. Wie een vrije tegel claimt, wordt eigenaar; op een tegel van een ander kun je niet
bouwen.

- **Verschillende slots**: de speler met het **laagste slot** krijgt de tegel. De ander bouwt de rest van zijn
  route, maar niet over die tegel (en betaalt alleen wat gebouwd is). In het rapport staat bijvoorbeeld:
  *"✖ Tegel (21, 9) al van Konkurrent BV (beurt 1, slot 1)"*.
- **Zelfde slot**: beide spelers krijgen de tegel. Ieder legt er zijn eigen weg of spoor; de tegel is gedeeld
  en beiden kunnen hem gebruiken. Leggen ze precies hetzelfde stuk, dan is dat stuk van allebei.
- **Twee stations van verschillend type** op dezelfde tegel in hetzelfde slot: beide worden geweigerd. Hetzelfde
  type: één gedeeld station.
- Schuine stukken mogen elkaar niet kruisen zonder kruising (anders zou je een andermans route "door" kunnen).
- Kruisingen met je **eigen** netwerk mogen wel: je weg kan je eigen spoor kruisen (overweg) en routes van
  hetzelfde type vormen een splitsing.
- Allianties veranderen niets aan de conflictregels.

## Netwerk, terrein en kosten

Kosten per stuk op vlak gras (een schuin stuk kost √2 ≈ 1,41 keer zoveel):

| | Bouwen | Onderhoud per beurt |
| --- | --- | --- |
| Weg | € 2.500 | € 25 |
| Spoor | € 6.000 | € 60 |
| Kanaal | € 20.000 | € 100 |

Terreinfactor: zand ×1,2 · bos ×1,5 · heuvels ×2,2 · bergen ×4 (tunnel, niet voor kanalen) · water ×6 (brug).
Kanalen over open water zijn gratis: schepen varen daar al.

- **Stadsstraten** zijn openbaar: vrachtwagens van iedereen mogen erover rijden.
- **Schepen** varen vrij over open water; kanalen (van jou of een bondgenoot) verbinden water over land.
- Bruggen hinderen schepen niet.

## Stations

| Station | Kosten | Onderhoud | Bereik |
| --- | --- | --- | --- |
| 🚏 Vrachtstation | € 30.000 | € 1.000 | 2 tegels |
| 🚉 Treinstation | € 90.000 | € 3.000 | 3 tegels |
| ⚓ Haven | € 100.000 | € 3.000 | 3 tegels, moet aan water liggen |

Een station bedient alle industrieën en steden waarvan een tegel binnen het bereik ligt (vierkant rond het
station). Stations zijn van de bouwer; gedeelde stations van allebei.

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

Fabrieken verwerken maximaal 120 eenheden per beurt en produceren alleen als ze grondstoffen krijgen. Wat ze maken
kan door iedereen met een station in de buurt worden opgehaald.

**Steden** vragen altijd voedsel en daarnaast 2–3 van: goederen, brandstof, gereedschap, bouwmaterialen. Hoeveel
ze per beurt willen hangt af van het aantal inwoners. Lever je meer dan de vraag, dan krijg je voor het meerdere
maar 40% van de prijs.

Liggen er meerdere stations met actieve lijnen bij één industrie, dan wordt de productie eerlijk over die stations
verdeeld.

## Voertuigen

| Voertuig | Lading | Snelheid (tegels per beurt) | Prijs | Onderhoud per beurt |
| --- | --- | --- | --- | --- |
| 🚚 Vrachtwagen | 20 | 40 | € 45.000 | € 4.000 |
| 🚛 Zware vrachtwagen | 32 | 32 | € 75.000 | € 6.000 |
| 🚂 Stoomtrein | 90 | 56 | € 220.000 | € 15.000 |
| 🚆 Dieseltrein | 140 | 88 | € 380.000 | € 24.000 |
| 🛥️ Binnenvaartschip | 150 | 22 | € 140.000 | € 9.000 |
| 🚢 Vrachtschip | 280 | 30 | € 260.000 | € 16.000 |

Een beurt wordt in 40 stappen gesimuleerd. Een voertuig laadt bij het ene station wat het andere station accepteert,
rijdt met zijn eigen snelheid en levert af bij aankomst. Daarna laadt het voor de terugweg (als er iets terug te
vervoeren valt). Voertuigen zijn aan het eind van een beurt gewoon onderweg en rijden de volgende beurt verder.
Meerdere voertuigen op één lijn vertrekken gespreid.

## Opbrengst

Bij aflevering krijgt de eigenaar van het voertuig:

```
opbrengst = hoeveelheid × basisprijs × marktprijs × afstand
```

- **afstand** = hemelsbrede afstand in tegels tussen het midden van de industrie waar de vracht vandaan kwam en het
  midden van de bestemming (industrie of stad). Een omweg levert dus niets extra op, een lange verbinding wel.
- **basisprijs** per ton per tegel: grondstoffen € 28–36, producten € 48–85 (zie het tabblad Markt).
- Voorbeeld: 20 ton graan (€ 32) over 22 tegels bij marktprijs ×1,00 = 20 × 32 × 22 = **€ 14.080**.

Het spel toont deze berekening vooraf bij het inzetten van voertuigen: verwachte vracht per beurt, opbrengst,
onderhoud, netto per beurt en terugverdientijd.

## Markt

Elke goedsoort heeft een marktprijs (×0,50 tot ×1,60, start ×1,00). Na elke beurt beweegt die richting een
doelprijs: `1,30 − 0,55 × (geleverd op de hele kaart / vraag op de hele kaart)`. Wordt een goed weinig geleverd,
dan stijgt de prijs; leveren veel spelers hetzelfde, dan daalt hij. Per beurt wordt 35% van het verschil
overbrugd, met een kleine willekeurige schommeling.

## Kosten en geld

Na de simulatie betaal je onderhoud voor voertuigen, stations en infrastructuur (gedeelde infrastructuur betaal je
samen). Je saldo kan negatief worden; dan mislukken bouw- en koopacties tot je weer geld hebt. Verkoop dan
voertuigen of wacht op opbrengsten. (Leningen en aandelen staan op de roadmap.)

## Allianties

- Stel in het tabblad **Spelers** een alliantie voor; de ander accepteert of weigert. Een speler zit in hoogstens
  één alliantie; een bestaande alliantie kan nieuwe leden uitnodigen.
- Bondgenoten mogen elkaars **wegen, sporen, kanalen en stations** gebruiken en mogen hun eigen routes op die van een
  bondgenoot laten aansluiten.
- Wie de alliantie verlaat, verliest die toegang meteen: voertuigen die over het netwerk van een oud-bondgenoot
  reden, komen stil te staan tot er weer een route is.
