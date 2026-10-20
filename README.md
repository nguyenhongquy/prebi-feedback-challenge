# Mensch oder KI? – Feedback im Vergleich

Ein responsiver, deutschsprachiger Prototyp für die Reflection Week an der PH
Ludwigsburg. Besucher*innen vergleichen zwei Rückmeldungen zu einer fiktiven
Reflexion, stimmen ab, sehen die Auflösung und erhalten simulierte Ergebnisse.

## Lokal starten

Voraussetzung: Node.js 20.19+ oder 22.12+.

```sh
npm install
npm run dev
```

Vite zeigt anschließend die lokale Adresse im Terminal an.

## Prüfen

```sh
npm test
npm run lint
npx tsc -b
npm run build
```

`npm test` prüft die zufällige Fall- und Feedback-Reihenfolge, die Auflösung,
die Vermeidung bereits gespielter Fälle, den Schutz vor doppelter Abstimmung
und das Zurücksetzen des Sitzungsfortschritts.
Zusätzliche Komponententests prüfen die Feedback-Sprunglinks, den Abstimmungs-
und Ladezustand, die Auflösung sowie beschriftete Demo-Diagramme.

## Phase 2: echte anonyme Abstimmung

Der vorhandene Mock-Modus bleibt der Standard. Mit `VITE_API_MODE=supabase`
werden stattdessen öffentliche Edge Functions verwendet; Fälle, Auflösung und
Stimmen bleiben in der Datenbank. Der Supabase Data API bleibt deaktiviert.
Die bereitgestellten Fälle sind weiterhin ausschließlich fiktiv.

Setup, nicht-destruktive Migration, erforderliche Server-Secrets, lokale Tests
und Deployment-Schritte stehen in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).
Die Projektverantwortlichen haben die gehostete Abstimmung und idempotente
Wiederholung geprüft; Einzelheiten stehen in der Setup-Anleitung.

## GitHub Pages

Der manuell gestartete Workflow [pages.yml](./.github/workflows/pages.yml) baut
den Supabase-Modus und veröffentlicht ausschließlich `dist/`. Er läuft nur für
`main`, nicht für Pull Requests oder den Feature-Branch. Vor dem ersten Start
sind Pages, öffentliche Repository-Variablen und die Freigabe des Origins nötig.
Die [Deployment-Checkliste](./SUPABASE_SETUP.md#github-pages-frontend-deployment)
beschreibt Einrichtung, Freigaben und Prüfung. Ein Commit oder Merge allein
startet kein Deployment.

```sh
cp .env.example .env.local
# Für lokale Demodaten: VITE_API_MODE=mock
# Für echte Abstimmungen: öffentliche Supabase-URL/Publishable-Key ergänzen
npm run dev
```

`npm test` führt zusätzlich die SQL-Migration in einem isolierten PostgreSQL-
Testsystem aus und prüft Runden, Normalisierung, Wiederholungsanfragen,
Zugriffsrechte und den Produktionsadapter. Weitere Prüfungen:

```sh
npm run check:functions
npm run test:production-bundle
```

### Mobile und Tastatur manuell prüfen

- Bei 375 und 390 Pixel Breite: Beide Feedback-Karten über „Zu Feedback A/B“
  ansteuern, vollständig lesen und beide Fragen beantworten. Erst dann ist
  „Antworten ansehen“ aktiv. Bei reduzierter Bewegung erfolgt der Sprung ohne
  sanftes Scrollen.
- Bei 768 und 1280 Pixel Breite: Karten und Diagramme nebeneinander, ohne
  horizontalen Überlauf, prüfen.
- Mit Tab und Enter navigieren. Nach Bildschirmwechseln erhält die neue
  Überschrift den Fokus; nach einem Übermittlungsfehler die Fehlermeldung.
  Antworten bleiben bei Fehlern erhalten und können erneut gesendet werden.
- Auflösung, Demodaten, „Noch eine Runde?“ und „Fertig“ prüfen.
  „Neue Person / Zurücksetzen“ muss zum Start zurückführen und Antworten sowie
  Fallhistorie nur in diesem Browser-Tab löschen, auch während einer Anfrage.

## Phase 1: lokaler Prototyp

- Alle drei Fälle und beide Rückmeldungen pro Fall sind vollständig erfunden.
- Ein Mock-API hält dieselbe Start-/Abstimmungs-Schnittstelle für spätere
  Adapter bereit; es gibt keine Supabase-Verbindung und keine gespeicherten
  echten Stimmen.
- Die Ergebnisse sind simuliert, fallbezogen und werden als **Demodaten**
  ausgewiesen. Kleine Stichproben werden ausdrücklich eingeordnet.
- Der Fortschritt wird nur in `sessionStorage` gehalten. „Neue Person /
  Zurücksetzen“ löscht ihn.
- `vite.config.ts` setzt den Basis-Pfad für GitHub Pages auf
  `/prebi-feedback-challenge/`.
- Das bereitgestellte PH-Ludwigsburg-Logo und die Schrift Figtree sind lokal
  eingebunden. Die Oberfläche folgt der Corporate-Design-Zusammenfassung 2026
  und der Grüntöne-Farbvorgabe. Das vollständige Wortbildzeichen steht wie im
  Leitfaden empfohlen unten links im Footer.
- Die zwei WOFF2-Teilfonts und ihre SIL Open Font License liegen in
  `src/assets/brand/`; zur Laufzeit werden keine externen Schriftdateien
  geladen.

Im Mock-Modus liegt die Antwortzuordnung absichtlich im Browser. Im Supabase-
Modus wird der Mock-Adapter nicht in den Produktionsbuild aufgenommen; die
Auflösung und die manuell formulierten Hinweise kommen erst nach der
Abstimmung vom Server. Die Einrichtung und Freigabe des Backends erfolgt
separat nach Prüfung durch die Projektverantwortlichen.
