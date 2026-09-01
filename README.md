# Room Visualizer

WebXR-Raumplaner in TypeScript (Vite + Three.js). Entwickelt für die **Meta Quest 3**,
aber genauso im Desktop-Browser nutzbar – mit umschaltbarer **3D-**, **isometrischer**
und **2D-Grundriss-Ansicht**.


**Live:** https://baumgartner-software.github.io/room-visualizer/

## Ziel des Projekts

Einen Raum (Breite × Länge × Höhe) definieren, Einrichtungselemente aus einem Katalog
hineinstellen und diese direkt im Raum verschieben, drehen und in der Größe anpassen –
am Ende immersiv mit der Quest 3 (VR oder AR/Passthrough), unterwegs aber auch bequem
am Desktop in 3D, isometrisch oder als 2D-Grundriss.

Erster Anwendungsfall ist die **Küchenplanung**: Elemente im 60-cm-Raster
(Unterschrank, Schubladenschrank, Spülenschrank, Herdumbau, Hängeschrank,
Hochschrank, Kühlschrank) sowie eine frei in der Länge ziehbare **Arbeitsplatte**.

## Funktionen (Stand: erstes Ziel)

- Raum definieren (Breite, Länge, Höhe in cm) – im Browser-Panel oder im VR-Menü
- Katalog-Menü zum Platzieren von Elementen (Küche im 60er-Raster, Arbeitsplatte, freie Box)
- **Bearbeitungsmodus**: am ausgewählten Element erscheinen sechs Griffkugeln
  (rot = X, grün = Y, blau = Z). Kugel ziehen = Größe der jeweiligen Seite ändern.
  Element selbst ziehen = verschieben. Drehen in 90°-Schritten.
- Ansichten: 3D (Orbit), isometrisch, 2D-Grundriss (Draufsicht) – jederzeit umschaltbar
- WebXR: `immersive-vr` und `immersive-ar` (Passthrough auf der Quest 3).
  Controller-Trigger = auswählen/ziehen, Griff-Taste = 3D-Menü vor sich holen.
- Automatisches Speichern im Browser (localStorage), Export/Import als JSON
- Tastatur: `R` drehen, `Entf` löschen, `E` Griffe an/aus, `Esc` abwählen

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # Typecheck + Produktions-Build nach dist/
npm run preview    # Build lokal ansehen
```

Für Tests mit der Quest 3 muss die Seite über HTTPS erreichbar sein. Am einfachsten ist
die veröffentlichte GitHub-Pages-Seite; alternativ `adb reverse tcp:5173 tcp:5173` mit
dem Dev-Server (dann `http://localhost:5173` im Quest-Browser, `localhost` gilt als
sicherer Kontext).

### Projektstruktur

| Datei | Inhalt |
| --- | --- |
| `src/main.ts` | Einstieg: Renderer, Szene, Verdrahtung von Maus/Tastatur, Render-Loop |
| `src/store.ts` | Zustand (Raum + Elemente), Persistenz, Snapping/Clamping |
| `src/catalog.ts` | Element-Katalog (Küche) |
| `src/room.ts` | Darstellung des Raums (Wände, Boden, Raster) |
| `src/elements.ts` | Meshes der platzierten Elemente |
| `src/editor.ts` | Auswahl, Verschieben, Griffkugeln/Resize – arbeitet mit Weltstrahlen, daher identisch für Maus und XR-Controller |
| `src/views.ts` | Kameras/Steuerung für 3D, isometrisch, 2D |
| `src/xr.ts` | WebXR-Session, Controller, 3D-Menü in VR/AR |
| `src/ui.ts` | HTML-Seitenpanel |

Alle Maße intern in **Metern**; die UI zeigt Zentimeter. Der Raumursprung ist die linke
vordere Bodenecke, `position` eines Elements ist die Mitte seiner Unterkante.

## Deployment

Bei **jedem Push** baut die GitHub Action (`.github/workflows/deploy.yml`) das Projekt
(Typecheck + Vite-Build). Pushes auf `main` werden zusätzlich auf **GitHub Pages**
veröffentlicht.

Einmalig muss in den Repository-Einstellungen unter **Settings → Pages → Build and
deployment → Source** die Option **GitHub Actions** gewählt werden
(https://github.com/baumgartner-software/room-visualizer/settings/pages). Der Actions-Token
darf Pages nicht selbst aktivieren; bis dahin schlägt nur der Deploy-Job fehl, der Build
läuft. Danach den Workflow erneut starten („Re-run“) oder einfach den nächsten Push abwarten.

## Arbeitsweise / Hinweise für Agenten

- **Direkt auf `main` pushen ist erlaubt und erwünscht** – auch für KI-Agenten
  (z. B. Claude Code). Kein Pull-Request nötig, der Build/Deploy läuft automatisch.
- Vor dem Push `npm run build` ausführen (Typecheck + Build müssen fehlerfrei sein).
- Änderungen an Funktionsumfang bitte in diesem README nachziehen.

## Roadmap / Ideen

- Hand-Tracking auf der Quest 3 (aktuell Controller)
- Wandmontierte Elemente automatisch an Wände einrasten, Kollisionsprüfung
- Maßangaben/Bemaßung im 2D-Grundriss
- Weitere Kataloge (Bad, Wohnzimmer), Texturen/Materialien
- Teilen von Projekten per Link
