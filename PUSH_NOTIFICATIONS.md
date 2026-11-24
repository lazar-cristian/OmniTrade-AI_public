# Web Push

## Funzionalità

- Ogni browser/PWA registra una subscription distinta, collegata all'utente autenticato e al suo dispositivo.
- Le preferenze di attivazione e categoria sono per dispositivo: `news`, `trading_alerts`, `macroeconomy`, `earnings`, `system`, `portfolio`, `journal`, `backtest`.
- `portfolio` invia un avviso agli altri dispositivi quando viene registrato un movimento o una posizione; `journal` avvisa dopo il salvataggio di un trade. `backtest` è predisposta per i processi server-side: i backtest attuali sono sincroni nel browser e non generano una notifica separata.
- L'invio avviene dal server Supabase. Non dipende da timer JavaScript o da una pagina aperta; il sistema operativo e il provider push possono comunque ritardare la consegna.
- Il payload include URL, tipo e ID risorsa. Il service worker apre l'URL esatto, oppure instrada le notifiche senza URL esplicito alla sezione pertinente.

## Configurazione Supabase

1. Per un progetto Supabase nuovo, applicare prima `supabase/schema_fase1.sql` (e lo schema del wallet già usato dal progetto). Poi applicare le migration in ordine:

   ```text
   supabase/migrations/20261123200000_web_push_notifications.sql
   supabase/migrations/20261124193000_strategy_marketplace.sql
   supabase/migrations/20261124202055_trade_journal_and_macro_reminders.sql
   ```

   L’ultima abilita il Journal strutturato, RLS per proprietario e tabelle private di calendario/promemoria. Non abilita automaticamente alcuna fonte di eventi macro.
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
   supabase functions deploy macro-event-reminders
   ```

   Mantenere la verifica JWT Supabase attiva: i producer pianificati richiedono il bearer `SUPABASE_SERVICE_ROLE_KEY`; il dispatcher accetta richieste utente solo per il test e per notifiche personali delle categorie `portfolio`, `journal` e `backtest`. Non inserire mai la service-role key nel browser.
4. Pianificare con Supabase Cron/HTTP due richieste `POST` ogni cinque minuti: `/functions/v1/news-push-alerts` e `/functions/v1/macro-push-alerts`. Includere `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, `apikey: <SUPABASE_SERVICE_ROLE_KEY>`, `Content-Type: application/json` e body `{}`. Le News vengono inizializzate senza inviare lo storico al primo avvio; in seguito gli articoli nuovi sono inviati solo alla categoria `news`, mentre gli articoli macro sono gestiti separatamente dalla categoria `macroeconomy`. I due producer hanno registri di deduplica separati; gli articoli con errori di consegna restano ritentabili.

## Promemoria eventi macro a 30/5 minuti

`macro-event-reminders` controlla ogni minuto gli eventi ad alto impatto in `public.macro_calendar_events` e invia un promemoria 30 e 5 minuti prima, con deduplica atomica per evento. Per attivarlo:

1. Abilitare `pg_cron`, `pg_net` e Vault nelle estensioni Supabase.
2. Distribuire `macro-event-reminders` con verifica JWT attiva.
3. In Supabase Dashboard → Database → Vault, creare i secret `omnitrade_project_url` e `omnitrade_service_role_key`. Inserire i valori lì, non nel frontend, in una query SQL o in questo repository.
4. Creare un job `* * * * *` che chiama `/functions/v1/macro-event-reminders` via `net.http_post`, impostando `Authorization: Bearer <secret>`, `apikey: <secret>` e body `{}`. La function rifiuta chiamate che non presentano il bearer service-role esatto.
5. Con la modalità manuale scelta, inserire gli eventi effettivi nel SQL Editor da una fonte affidabile. Campi richiesti: ID stabile, titolo, impatto (`high`, `medium` o `low`) e timestamp ISO con timezone; valuta e URL HTTPS sono facoltativi. La tabella non è accessibile dal client e i promemoria non partono finché non vi sono eventi futuri. Non serve una chiave API.

Esempio per pianificare il job dopo aver creato i due secret in Vault (nell’SQL Editor non occorre inserire le chiavi):

```sql
select cron.schedule(
    'omnitrade-macro-event-reminders',
    '* * * * *',
    $job$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'omnitrade_project_url')
            || '/functions/v1/macro-event-reminders',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'omnitrade_service_role_key'),
            'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'omnitrade_service_role_key')
        ),
        body := '{}'::jsonb
    );
    $job$
);
```

Esempio di upsert eseguito da un processo fidato con service role (sostituire valori con un evento reale; non eseguirlo con dati inventati in produzione):

```sql
insert into public.macro_calendar_events
    (id, title, currency, impact, event_at, source_url, updated_at)
values
    ('<provider>:<event-id>', '<event title>', 'USD', 'high',
     '<ISO-8601 timestamp with timezone>', '<HTTPS source URL>', now())
on conflict (id) do update set
    title = excluded.title,
    currency = excluded.currency,
    impact = excluded.impact,
    event_at = excluded.event_at,
    source_url = excluded.source_url,
    is_active = true,
    updated_at = now();
```

Il job considera un ritardo massimo di cinque minuti per recuperare una schedulazione saltata; gli eventi passati non generano notifiche. I provider push possono comunque ritardare la consegna.

Il test unitario della finestra temporale è eseguibile con `deno test supabase/functions/_shared/macro-reminders_test.ts`.

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

Le categorie accettate sono `news`, `trading_alerts`, `macroeconomy`, `earnings`, `system`, `portfolio`, `journal`, `backtest`. Con service-role key, `userId` indirizza un singolo utente e `broadcast: true` raggiunge tutti i dispositivi attivi per quella categoria. Un utente autenticato può inviare il test integrato (`{ "test": true }`) oppure una notifica personale di `portfolio`, `journal` o `backtest`: il server vincola il destinatario al suo account e non accetta un broadcast dal browser. `excludeDeviceId` esclude un dispositivo dello stesso account. L'URL può essere relativo all'app o HTTPS. Le subscription scadute (HTTP 404/410) vengono rimosse automaticamente.

## Supporto browser

Servono HTTPS e un browser con Service Worker, Push API e Notification API. Su iPhone/iPad il push web è supportato da iOS/iPadOS 16.4 o successivi per le web app aggiunte alla schermata Home; iOS non consente al sito Safari aperto in una scheda normale di registrare una subscription push.
