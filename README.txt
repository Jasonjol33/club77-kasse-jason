CLUB 77 KASSENSYSTEM – mit Mitarbeiterkonten, getrennten Rechnungen und Admin-Panel
===================================================================================

INHALT
  public/index.html, public/app.js   Oberfläche (Design + Bedienung wie in deiner Club77.html)
  server.js, lib/*.js                Server (Anmeldung, Rechte, Rechnungen, Umsatz, Discord)
  scripts/create-admin.js            Admin anlegen / Passwort zurücksetzen (Notfall)
  scripts/backup.js                  Datenbank-Sicherung
  test/run-tests.js                  Automatische Tests (npm test)
  Dockerfile, docker-entrypoint.sh, fly.toml

!!! ZUERST: DEIN DISCORD-WEBHOOK IST BEKANNT !!!
  In der alten Club77.html stand die Webhook-URL im Klartext (öffentlich lesbar).
  Jeder, der die Seite je geöffnet hat, kann damit Nachrichten in deinen Kanal schreiben.
  -> Discord: Servereinstellungen > Integrationen > Webhooks > alten Webhook LÖSCHEN und
     einen NEUEN erstellen. Den neuen NUR als Fly-Secret setzen (siehe unten).

LOKAL TESTEN (Node.js 22.13 oder neuer)
  PowerShell:
    $env:ADMIN_USERNAME = "admin"
    $env:ADMIN_PASSWORD = "EinLangesEinzigartigesPasswort"
    npm start
  Linux/Mac:
    ADMIN_USERNAME=admin ADMIN_PASSWORD='EinLangesEinzigartigesPasswort' npm start
  Dann http://localhost:8080 öffnen. Daten liegen lokal in ./data/club77.db
  Tests: npm test

DEPLOY AUF FLY.IO (App "club77-ivory-smoke-861")
  1) Im Projektordner:
       fly volumes list -a club77-ivory-smoke-861
     Falls "club77_data" fehlt:
       fly volumes create club77_data --region fra --size 1 -a club77-ivory-smoke-861
  2) Secrets setzen (NIE in Dateien oder ins Frontend schreiben):
       fly secrets set ADMIN_USERNAME="admin" ADMIN_PASSWORD="STARKES-EINMALIGES-PASSWORT" -a club77-ivory-smoke-861
       fly secrets set DISCORD_WEBHOOK="https://discord.com/api/webhooks/..." -a club77-ivory-smoke-861
  3) Deployen:
       fly deploy -a club77-ivory-smoke-861
  4) Anmelden mit ADMIN_USERNAME / ADMIN_PASSWORD. Danach das Admin-Passwort unter
     "Passwort ändern" auf ein eigenes setzen und das Secret entfernen:
       fly secrets unset ADMIN_PASSWORD -a club77-ivory-smoke-861
  Alternative ohne ADMIN_PASSWORD-Secret: Beim ersten Start steht ein SETUP-CODE im Log
  ("fly logs"). Damit legst du den Admin auf der Webseite an (nur solange noch kein Admin existiert).
  Wichtig: Es darf nur EINE Maschine laufen (SQLite auf Volume). Nicht skalieren: kein "fly scale count 2".

MITARBEITER
  Mit Discord-Anmeldung (empfohlen, siehe unten): Wer auf dem Discord-Server die Mitarbeiter-Rolle bekommt, klickt auf
  "Mit Discord anmelden" – das Konto wird automatisch angelegt. Keine Discord-ID, kein Passwort, nichts von Hand eintragen.
  Zugang entziehen: Mitarbeiter-Rolle auf Discord entfernen (wirkt beim nächsten Login). Soll es sofort gelten:
  Admin > Mitarbeiterverwaltung > "Deaktivieren" (beendet sofort alle Sitzungen und sperrt auch den Discord-Login).
  Löschen: Admin > Mitarbeiterverwaltung > "Löschen". Das Konto verschwindet KOMPLETT (Konto, Sitzungen, Discord-Verknüpfung,
  Benutzername wird wieder frei). Es gibt kein Archiv und kein "Wiederherstellen" mehr. Bereits erstellte Rechnungen/Stornos sind
  unveränderbar und bleiben bestehen (Buchhaltung): darin steht nur noch der Name als Text. In der Umsatzübersicht erscheint der
  Name mit dem Status "gelöscht", solange er im gewählten Zeitraum Umsatz hat. Früher archivierte Konten werden beim Start entfernt.
  WICHTIG: Wer die Discord-Rolle noch hat, bekommt beim nächsten Discord-Login automatisch ein NEUES Konto (ohne alte Rechnungen).
  Zugang dauerhaft entziehen = zusätzlich die Mitarbeiter-Rolle auf Discord entfernen. Wer nur gesperrt, aber nicht gelöscht
  werden soll: "Deaktivieren".
  Ohne Discord (Notfall/Passwort): Admin > Mitarbeiterverwaltung > Benutzername eintragen. Leeres Passwortfeld = Passwort wird
  zufällig erzeugt und EINMALIG angezeigt; der Mitarbeiter muss es beim ersten Login ändern. Admin > "Passwort zurücksetzen".
  Admin-Passwort vergessen:
    fly ssh console -a club77-ivory-smoke-861
    ADMIN_PASSWORD='NeuesLangesPasswort' node scripts/create-admin.js admin

WAS SICH GEGENÜBER DER ALTEN DATEI GEÄNDERT HAT
  - Kassierer-Name: kommt aus der Anmeldung (kein Freitext mehr).
  - Preise/Summen/Rabatt werden NUR am Server berechnet (Katalog: lib/catalog.js, 1:1 aus deiner Datei).
    Preisänderungen: dort ändern + neu deployen; alte Rechnungen behalten ihren Preis.
  - "Tagesumsatz reset" entfällt: Rechnungen sind unveränderbar. Der Tagesumsatz ist je Mitarbeiter die Summe seiner
    Rechnungen des aktuellen Geschäftstags (Standard: Tag beginnt 06:00 Uhr, DAY_START_HOUR in fly.toml). Ein Fehler
    wird per Stornobuchung (nur Admin, mit Grund) korrigiert.
  - "Bon senden" speichert den Bon (Nummer R-000001 …) NUR im Kassensystem (wird gesammelt) und zählt zum Tagesumsatz.
    Bons und Stornos werden NIE automatisch an Discord gesendet. Nach Discord geht ausschließlich der Tagesumsatz.
  - Neu: Rabattgrund (optional), Minus-Knopf je Produkt (Handy hat kein Rechtsklick; Rechtsklick geht weiterhin).
  - Zahlungsart: gab es in deinem System nicht, daher nicht eingebaut.
  - Der Tagesumsatz-Discord-Bericht hat das alte Format und wird nur per Knopfdruck gesendet: Mitarbeiter senden ihren eigenen,
    Admin zusätzlich den Gesamtbericht.
  - Die alte Prototyp-Datei club77.json aus dem früheren ZIP wird nicht übernommen (Neustart mit leerer Datenbank).

ANMELDUNG / AUTORISIERUNG MIT DISCORD
  Discord entscheidet, wer an die Kasse darf: Mitglied deines Discord-Servers + Mitarbeiter-Rolle. Beim ersten Login wird das
  Konto automatisch angelegt (Benutzername = Server-Spitzname, z. B. "Anna K" -> "AnnaK"; bei Doppelungen "AnnaK2").
  Optional: eine Admin-Rolle. Wer sie hat, ist Administrator; wird sie entzogen, ist die Person beim nächsten Login wieder
  normaler Mitarbeiter (der letzte aktive Admin wird nie herabgestuft). Ohne Admin-Rolle bleiben alle neuen Konten Mitarbeiter.
  Der Discord-Login ist nur aktiv, wenn ALLE Werte unten gesetzt sind (Admin-Rolle ist optional).
  1) https://discord.com/developers/applications > "New Application" > Reiter "OAuth2":
     - Client ID und Client Secret kopieren
     - Unter "Redirects" EXAKT eintragen (ohne Leerzeichen/Schrägstrich am Ende):
         https://club77-ivory-smoke-861.fly.dev/api/auth/discord/callback
       (lokal zum Testen zusätzlich: http://localhost:8080/api/auth/discord/callback)
  2) IDs sammeln (Discord > Einstellungen > Erweitert > Entwicklermodus AN):
     - Server-ID: Rechtsklick auf den Server > "Server-ID kopieren"
     - Rollen-ID: Servereinstellungen > Rollen > Rechtsklick auf die Rolle > "Rollen-ID kopieren"
       (eine Rolle "Kasse" / "Mitarbeiter" anlegen und den Crew-Mitgliedern geben)
  3) Secrets setzen (PowerShell):
       fly secrets set PUBLIC_URL="https://club77-ivory-smoke-861.fly.dev" DISCORD_CLIENT_ID="..." DISCORD_CLIENT_SECRET="..." -a club77-ivory-smoke-861
       fly secrets set DISCORD_GUILD_ID="..." DISCORD_STAFF_ROLE_ID="..." -a club77-ivory-smoke-861
     Optional Admin-Rolle:
       fly secrets set DISCORD_ADMIN_ROLE_ID="..." -a club77-ivory-smoke-861
  Es wird nur die Berechtigung "Mitglieds-Infos auf dem Server lesen" (guilds.members.read) angefragt – kein Bot nötig.
  Hinweis: Eine entzogene Rolle wirkt erst beim nächsten Login (Discord wird nicht laufend gefragt). Sofort sperren = "Deaktivieren".
  Bestehende Passwort-Konten (z. B. der erste Admin) können oben über "Discord verknüpfen" mit Discord verbunden werden.
  Den OAuth-Client-Secret NIE in HTML/JS oder ZIP-Dateien schreiben - nur als Fly-Secret.

SICHERHEIT (Kurzfassung)
  scrypt-Passwort-Hashes; Sitzungen serverseitig (Cookie HttpOnly, SameSite=Strict, Secure); Rechte bei jedem Aufruf am Server
  geprüft; Fremde Rechnungen liefern 404; Login-Sperre nach 5 Fehlversuchen; CSRF-Schutz; strenge CSP; Rechnungen per
  Datenbank-Trigger unveränderbar; Protokoll aller wichtigen Aktionen (Admin > Protokoll).
  Mitarbeiter-Rabatt begrenzen: MAX_STAFF_DISCOUNT in fly.toml (z. B. "30").

SICHERUNG
  Automatisch täglich in /data/backups (letzte 14). Zusätzlich macht Fly Volume-Snapshots. Manuell:
    fly ssh console -a club77-ivory-smoke-861  ->  node scripts/backup.js
  Admin > Umsatzübersicht > CSV-Export für die Buchhaltung.
  Hinweis: Rechtliche Anforderungen an Rechnungen/Kassenführung (z. B. GoBD) wurden nicht geprüft.
