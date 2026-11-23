# Web Push

## Funzionalità

- Ogni browser/PWA registra una subscription distinta, collegata all'utente autenticato e al suo dispositivo.
- Le preferenze di attivazione e categoria sono per dispositivo: `news`, `trading_alerts`, `macroeconomy`, `earnings`, `system`.
- L'invio avviene dal server Supabase. Non dipende da timer JavaScript o da una pagina aperta; il sistema operativo e il provider push possono comunque ritardare la consegna.
- Il payload include URL, tipo e ID risorsa. Il service worker apre l'URL esatto, oppure instrada le notifiche senza URL esplicito alla sezione pertinente.

## Configurazione Supabase

1. Applicare la migration `supabase/migrations/20261123200000_web_push_notifications.sql`.
2. Configurare una coppia VAPID pubblica/privata corrispondente e l'indirizzo di contatto:

   ```sh
   npx web-push generate-vapid-keys
   supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:support@example.com"
   ```

   Il frontend recupera la chiave pubblica dalla funzione `push-notifications`; non va copiata in `index.html`. Se la coppia VAPID cambia, rinnova la subscription da ciascun dispositivo.

3. Distribuire le funzioni:

   ```sh
   supabase functions deploy push-notifications
   supabase functions deploy news-push-alerts
   supabase functions deploy macro-push-alerts
   ```

   Mantenere la verifica JWT Supabase attiva: `news-push-alerts` e `macro-push-alerts` richiedono il bearer `SUPABASE_SERVICE_ROLE_KEY`; il dispatcher accetta inoltre richieste utente solo per l'invio del test integrato. Non inserire mai la service-role key nel browser.
4. Pianificare con Supabase Cron/HTTP due richieste `POST` ogni cinque minuti: `/functions/v1/news-push-alerts` e `/functions/v1/macro-push-alerts`. Includere `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, `apikey: <SUPABASE_SERVICE_ROLE_KEY>`, `Content-Type: application/json` e body `{}`. Le News vengono inizializzate senza inviare lo storico al primo avvio; in seguito gli articoli nuovi sono inviati solo alla categoria `news`, mentre gli articoli macro sono gestiti separatamente dalla categoria `macroeconomy`. I due producer hanno registri di deduplica separati; gli articoli con errori di consegna restano ritentabili.

## Invio da altri trigger server-side

`POST /functions/v1/push-notifications` con header `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` e body JSON:

```json
{
  "category": "trading_alerts",
  "title": "Alert VWAP",
  "body": "NVDA ha raggiunto il livello impostato.",
  "userId": "UUID-UTENTE",
  "resourceType": "strategy_alert",
  "resourceId": "ID-ALERT",
  "url": "?view=dashboard&resourceType=strategy_alert&resourceId=ID-ALERT"
}
```

Le categorie accettate sono `news`, `trading_alerts`, `macroeconomy`, `earnings`, `system`. `userId` indirizza un singolo utente; `broadcast: true` invia a tutti i dispositivi abilitati per quella categoria. L'URL può essere relativo all'app o HTTPS. Le subscription scadute (HTTP 404/410) vengono rimosse automaticamente. Un utente autenticato può inviare solo il test integrato (`{ "test": true }`); gli invii a utenti o in broadcast richiedono il service-role key.

## Supporto browser

Servono HTTPS e un browser con Service Worker, Push API e Notification API. Su iPhone/iPad il push web è supportato da iOS/iPadOS 16.4 o successivi per le web app aggiunte alla schermata Home; iOS non consente al sito Safari aperto in una scheda normale di registrare una subscription push.
