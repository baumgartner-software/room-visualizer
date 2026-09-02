# Room Visualizer

WebXR-Raumplaner in TypeScript (Vite + Three.js). Entwickelt für die **Meta Quest 3**,
aber genauso im Desktop-Browser nutzbar – mit umschaltbarer **3D-**, **isometrischer**
und **2D-Grundriss-Ansicht**.

**Live:** https://baumgartner-software.github.io/room-visualizer/

## So sieht die Küche aktuell aus

Diese Bilder werden bei jedem Push automatisch aus der laufenden Anwendung
gerendert (siehe [Automatischer Screenshot](#automatischer-screenshot)) – sie
zeigen also immer den echten Stand des Projekts.

![Küche in der 3D-Ansicht](docs/preview/kitchen.png)

| Isometrisch | Grundriss (2D) |
| --- | --- |
| ![Isometrische Ansicht](docs/preview/isometrisch.png) | ![Grundriss](docs/preview/grundriss.png) |

## Ziel des Projekts

Einen Raum definieren, Einrichtungselemente aus einem Katalog hineinstellen und
diese direkt im Raum verschieben, drehen, einfärben und in der Größe anpassen –
am Ende immersiv mit der Quest 3 (VR oder AR/Passthrough), unterwegs aber auch
bequem am Desktop in 3D, isometrisch oder als 2D-Grundriss.

Erster Anwendungsfall ist die **Küchenplanung** im echten Grundriss des Hauses.

## Grundriss und Standard-Küche

Beim ersten Start (und über *Zurücksetzen*) lädt die Anwendung den Wohnbereich
aus der Bauplan-Skizze und eine fertig eingerichtete Küche.

| Bauplan (Handskizze) | Referenz-Rendering der Küche |
| --- | --- |
| ![Grundriss-Skizze](docs/referenz/grundriss-skizze.jpg) | ![Küchen-Rendering](docs/referenz/kuechen-rendering.jpg) |

**Aus der Skizze übernommen** (Ursprung = nordwestliche Innenecke, x nach Osten,
z nach Süden; alle Maße in cm):

| Maß | Wert |
| --- | --- |
| Nordwand | 681 – aufgeteilt in 76,5 Wand · 209 Glastür · 91 Wand · 209 Glastür · 95 Wand |
| Ostwand | 682, mit Fenster 108 (89 vor der Südecke) |
| Küche | 409 (Westwand) × 244 (Südwand) |
| Flur | 152 breit, 273 lang, nach Süden offen (führt weiter zum Büro) |
| Südwand Wohnbereich | 285 |
| Wandscheibe am Flur | 43,5 diagonal |

Die beiden 209 cm breiten Öffnungen der Nordwand sind **bodentiefe Glastüren zur
Terrasse**, kein Fenster; das 108 cm breite Element der Ostwand ist ein Fenster.

**Angenommen** (in der Skizze nicht bemaßt): Raumhöhe 250 cm, Wandstärken
(außen 24, innen 12), Fensterbrüstung 95 cm, Oberkante von Fenster und
Terrassentüren 220 cm. Der
Bereich hinter dem Flur (Büro) ist in der Skizze abgeschnitten und daher nicht
modelliert. Alles davon lässt sich in `src/defaultProject.ts` anpassen.

Die **Küche** folgt diesem Raster:

```
X x x x x x x     X/x  Unterschrank + Arbeitsplatte + Hängeschrank darüber
H 0 0 0 0 0       H/h  Hochschrank
H 0 0 K K 0       K    Kochinsel
h 0 0 K K 0       0    frei
0 0 0 0 0 0
```

Die durchgehende Zeile aus sieben Unterschränken (6 × 60 cm + 49 cm Passstück =
409 cm) mit Arbeitsplatte und Hängeschränken liegt an der **Westwand** – der
einzigen Wand der Küche ohne Fenster und damit der einzigen, an die
Hängeschränke passen. Die Spüle sitzt in der Mitte dieser Zeile.

Der Block aus drei Hochschränken (Herdumbau mit Backofen, Hochschrank,
Kühlschrank) steht quer dazu an der **Südwand** zum Flur. An der Nordwand wäre
er nicht möglich, dort sitzt das 209 cm breite Fenster – falls der Block dort
stehen soll, muss das Fenster anders liegen.

Der Backofen sitzt im **mittleren** der drei Hochschränke.

Die Kochinsel (120 × 120 cm) mit Kochfeld und Dunstabzugshaube steht frei im
Raum, mit rund 105 cm Gang zur Zeile und zum Hochschrankblock. Kochfeld und
Haube liegen quer zur Insel.

Die Fronten sind im **Landhausstil** gehalten: pro Tür bzw. Schublade ein
aufgesetzter Rahmen, wodurch die Fläche dazwischen eingelassen wirkt, dazu
schwarze Stangengriffe. Welche Seite eines Möbels die Front ist, steht als
`front` am Element (lokale Achse, dreht sich beim Drehen mit).

## Funktionen

- **Raum**: Grundriss als Polygon (auch L-Form) mit Fenstern, Türöffnungen und
  Innenwänden. Raumhöhe frei einstellbar, alternativ ein einfacher Rechteck-Raum.
- **Puppenhaus-Ansicht**: Wände zwischen Kamera und Raum werden ausgeblendet.
  Steht man im Raum (XR), bleiben alle Wände stehen.
- **Katalog** mit Küchenelementen im 60er-Raster (Unterschrank, Schubladen-,
  Spülen-, Herdumbauschrank, Hängeschrank, Aufsatzschrank, Hochschrank,
  Kühlschrank), Arbeitsplatte, Kochinsel, Kochfeld, Spülbecken, Backofen,
  Dunstabzugshaube und Rückwand.
- **Werkzeuge**: *Ansicht* (nur umsehen und in XR umhergehen), *Bearbeiten*
  (Objekte auswählen und ändern) und *Farbe* (Pinsel). Das aktive Werkzeug steht
  in der Kopfzeile und in XR auf der Leiste unten rechts.
- **Zwei Schritte im Werkzeug *Bearbeiten***: erst **auswählen** – ein Klick bzw.
  Trigger sammelt Objekte ein (am Desktop mit <kbd>Umschalt</kbd> mehrere, in XR
  jeder Trigger-Druck) –, dann über *Griffe anzeigen* in den **Griff-Schritt**
  wechseln. Objekte lassen sich bewusst **nicht** direkt anfassen und wegziehen;
  bewegt wird nur über die Griffe. Im Griff-Schritt reagieren ausschließlich die
  Griffe, der Strahl geht durch alle anderen Objekte hindurch.
- **Griffe**: die Pfeile verschieben entlang genau einer Achse, die weiße Platte
  darüber frei in der Ebene – beides wirkt auf die **gesamte Auswahl**. Die sechs
  Kugeln ziehen die jeweilige Seite auf (rot = X, grün = Y, blau = Z) und
  erscheinen nur, wenn genau ein Objekt ausgewählt ist.
- **Hover-Rahmen**: Das Objekt unter dem Mauszeiger bzw. dem Controller-Strahl
  bekommt einen gelben Rahmen – auch Wände und Boden im Werkzeug *Farbe*.
- **Umgebung**: Rasenfläche und Himmelskuppel rund um das Haus, sichtbar durch
  die Terrassentüren.
- **Farbwerkzeug**: Farbe aus der Palette (oder eigene Farbe) wählen und
  Elemente, Wände oder den Boden per Klick einfärben – am Desktop und in VR.
  Die gewählte Farbe ist in beiden Paletten markiert.
- **Ansichten**: 3D (Orbit), isometrisch, 2D-Grundriss – jederzeit umschaltbar.
- **WebXR**: `immersive-vr` und `immersive-ar` (Passthrough auf der Quest 3).
  Controller-Trigger = auswählen/ziehen/malen, Griff-Taste = Menü vor sich holen.
  Das VR-Menü hat vier Seiten: Raum · Elemente · Farbe · Auswahl.
- **Steuerungs-Hilfe**: unten rechts im Fenster liegt eine ausklappbare Karte mit
  beiden Quest-3-Controllern und der Belegung je Werkzeug, dazu die Maus- und
  Tastaturbefehle. Da HTML in einer laufenden Immersive-Sitzung nicht sichtbar
  ist, gibt es dieselbe Grafik dort als Tafel im Blickfeld – einzublenden über
  das VR-Menü (*Raum → Steuerung zeigen*). Sie steht mittig im Blickfeld, hat
  oben rechts einen Schließen-Knopf, und solange sie offen ist, greift der
  Trigger nicht in die Szene – man kann also nichts versehentlich verstellen.
- **In XR immer sichtbar** ist nur eine kleine Leiste unten rechts mit *☰ Menü*
  dem aktiven Werkzeug, *Griffe zeigen* und *✕ Auswahl*; sie liegt über allen
  anderen Elementen. Das Menü selbst ist zu Beginn zu und wird über diese Leiste
  oder einen Druck auf den linken Stick auf- und zugeklappt, ein *✕* in seiner
  Reiterzeile schließt es ebenfalls.
  Leiste, Menü und Tafel folgen dem Kopf, bleiben also beim Gehen erreichbar.
- **Teilbarer Link**: der komplette Zustand steckt komprimiert im URL-Fragment
  (`#s=…`) und wird bei jeder Änderung sofort aktualisiert. Der Link geht nie an
  einen Server. Im Panel gibt es ihn zum Kopieren, dazu ein Feld mit dem
  Zustand als JSON zum Herauskopieren oder Einfügen.
- **Persistenz** im Browser (localStorage), Export/Import als JSON.

### Bedienung

| | |
| --- | --- |
| Maus | Klick = auswählen · <kbd>Umschalt</kbd>+Klick = weitere hinzunehmen · Griffe ziehen = bewegen und aufziehen · rechte Taste = schwenken |
| Tastatur | `E` Griffe zeigen / zurück zur Auswahl · `R` drehen · `Entf` löschen · `V` Ansicht · `P` Farbe · `Esc` zurück zu *Bearbeiten* |
| Quest 3 · immer | Trigger = Objekte auswählen · linken Stick drücken = Menü auf/zu · Leiste unten rechts = Menü · Werkzeug · Griffe zeigen · Auswahl aufheben |
| Quest 3 · Bearbeiten | Im Griff-Schritt: linker Stick ↑↓ = Höhe, ←→ = 90° drehen · rechter Stick = in der Ebene schieben (aus deiner Sicht) · A/X = duplizieren · B/Y = löschen – alles auf die gesamte Auswahl |
| Quest 3 · Ansicht und Farbe | Linker Stick = gehen und seitlich treten (in Blickrichtung) · rechter Stick ←→ = um 45° umsehen, ↑↓ = Augenhöhe |

### URL-Parameter

| Parameter | Wirkung |
| --- | --- |
| `?ui=0` | Bedienoberfläche ausblenden |
| `?reset=1` | Gespeicherten Stand ignorieren, mit Grundriss + Standardküche starten |
| `?view=kitchen\|isometric\|top` | Startansicht wählen |
| `?cam=px,py,pz,tx,ty,tz` | Freie Kameraposition und Blickpunkt in Grundriss-Metern |
| `#s=…` | Kompletter Zustand als komprimiertes Fragment (teilbarer Link) |

## Entwicklung

```bash
npm install
npm run dev         # http://localhost:5173
npm run build       # Typecheck + Produktions-Build nach dist/
npm run preview     # Build lokal ansehen
npm run screenshot  # Bilder in docs/preview/ neu rendern (benötigt Chromium)
```

Für `npm run screenshot` einmalig `npx playwright install chromium` ausführen.

Für Tests mit der Quest 3 muss die Seite über HTTPS erreichbar sein. Am
einfachsten ist die veröffentlichte GitHub-Pages-Seite; alternativ
`adb reverse tcp:5173 tcp:5173` mit dem Dev-Server (dann `http://localhost:5173`
im Quest-Browser, `localhost` gilt als sicherer Kontext).

### Projektstruktur

| Datei | Inhalt |
| --- | --- |
| `src/main.ts` | Einstieg: Renderer, Szene, Maus/Tastatur, Render-Loop, URL-Parameter |
| `src/defaultProject.ts` | Grundriss aus dem Bauplan + Standard-Küche |
| `src/store.ts` | Zustand (Raum + Elemente), Persistenz, Snapping/Clamping |
| `src/geometry.ts` | Grundriss-Mathematik (Bounding-Box, Schwerpunkt, Normalen) |
| `src/catalog.ts` | Element-Katalog |
| `src/room.ts` | Boden, Decke und Wände inklusive Fensteröffnungen |
| `src/elements.ts` | Meshes der platzierten Elemente |
| `src/editor.ts` | Auswahl, Verschieben, Griffkugeln, Farbwerkzeug – arbeitet mit Weltstrahlen und ist dadurch für Maus und XR-Controller identisch |
| `src/views.ts` | Kameras/Steuerung für 3D, isometrisch, 2D |
| `src/xr.ts` | WebXR-Session, Controller, Seitenmenü in VR/AR |
| `src/ui.ts` | HTML-Seitenpanel inklusive Farbpalette und Teilen-Bereich |
| `src/share.ts` | Zustand ⇄ komprimiertes URL-Fragment |
| `src/controllerHelp.ts` | Controller-Legende als SVG – im Panel und als XR-Tafel |
| `src/environment.ts` | Rasen und Himmel außerhalb des Hauses |
| `scripts/screenshot.mjs` | Headless-Rendering für die README-Bilder |

Alle Maße intern in **Metern**, die Oberfläche zeigt Zentimeter. Der
Raumursprung ist die nordwestliche Innenecke, `position` eines Elements ist die
Mitte seiner Unterkante.

## Deployment

Bei **jedem Push** baut `.github/workflows/deploy.yml` das Projekt (Typecheck +
Vite-Build). Pushes auf `main` werden zusätzlich auf **GitHub Pages**
veröffentlicht.

Voraussetzungen, die einmalig im Repository gesetzt werden müssen:

1. **Settings → Pages → Build and deployment → Source = „GitHub Actions“**
   ([Link](https://github.com/baumgartner-software/room-visualizer/settings/pages)).
   Der Actions-Token darf Pages nicht selbst aktivieren.
2. **Settings → Environments → `github-pages` → Deployment branches and tags**:
   `main` erlauben (oder „No restriction“)
   ([Link](https://github.com/baumgartner-software/room-visualizer/settings/environments)).

### Automatischer Screenshot

`.github/workflows/screenshot.yml` startet bei jedem Push auf `main` einen
Headless-Chromium, lädt die gebaute Anwendung mit `?reset=1&ui=0`, rendert die
drei Ansichten und committet die Bilder nach `docs/preview/` zurück auf `main`.
Der Commit trägt `[skip ci]` und löst deshalb keinen weiteren Lauf aus.

## Arbeitsweise / Hinweise für Agenten

- **Direkt auf `main` pushen ist erlaubt und erwünscht** – auch für KI-Agenten
  (z. B. Claude Code). Kein Pull-Request nötig, Build, Deploy und Screenshot
  laufen automatisch.
- Vor dem Push `npm run build` ausführen (Typecheck + Build müssen fehlerfrei sein).
- Änderungen am Funktionsumfang bitte in diesem README nachziehen.
- Die Bilder unter `docs/preview/` nicht von Hand bearbeiten – sie werden vom
  Workflow überschrieben.

## Roadmap / Ideen

- Hand-Tracking auf der Quest 3 (aktuell Controller)
- Elemente an Wänden und aneinander einrasten, Kollisionsprüfung
- Bemaßung im 2D-Grundriss, Grundriss im Editor bearbeiten
- Esszimmer und Wohnbereich möblieren, weitere Kataloge (Bad, Schlafzimmer)
- Hand-Tracking und Greifen von Elementen direkt mit der Hand
- Teleport als Alternative zur stufenlosen Fortbewegung
- Materialien und Texturen (Holzmaserung, Stein) statt Volltonfarben
