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
npm run build
```

`npm test` prüft die zufällige Fall- und Feedback-Reihenfolge, die Auflösung,
die Vermeidung bereits gespielter Fälle, den Schutz vor doppelter Abstimmung
und das Zurücksetzen des Sitzungsfortschritts.

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

Die Antwortzuordnung liegt in diesem lokalen Prototyp im Mock-Adapter. Vor
einem öffentlichen Einsatz müssen freigegebene Fälle und die Auflösung über
einen kontrollierten Server-Endpunkt bereitgestellt werden. Das ist nicht
Bestandteil von Phase 1.
