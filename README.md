# OmniTrade-AI

Per configurare Web Push, VAPID e l'invio server-side consulta [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md).

## AI Copilot

Per abilitare briefing e debrief giornalieri sincronizzati con l'account, applica la migration `supabase/migrations/20261125120000_copilot_daily_reports.sql` al progetto Supabase e distribuisci la Edge Function aggiornata:

```powershell
supabase db push
supabase functions deploy chat-ai
```

La funzione riutilizza `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` già configurati. Facoltativamente, imposta `OPENROUTER_QUICK_MODEL`, `OPENROUTER_ANALYSIS_MODEL` e `OPENROUTER_DEEP_MODEL` per associare modelli diversi ai tre livelli di risposta; se assenti, viene usato il modello predefinito.
