import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import {
  configureWebPush,
  createPushPayload,
  sendPushNotifications,
} from "../_shared/push.ts";
import { dueMacroReminderMinutes } from "../_shared/macro-reminders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo non supportato." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY || req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "Operazione riservata al servizio interno." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    configureWebPush();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const maxEventTime = new Date(now.getTime() + 30 * 60_000).toISOString();
    const { data: events, error } = await supabase
      .from("macro_calendar_events")
      .select("id,title,currency,event_at,source_url")
      .eq("is_active", true)
      .eq("impact", "high")
      .gt("event_at", now.toISOString())
      .lte("event_at", maxEventTime)
      .order("event_at")
      .limit(250);
    if (error) throw error;

    const summary = { eventsChecked: events?.length || 0, remindersClaimed: 0, delivered: 0, failed: 0 };
    for (const event of events || []) {
      const reminderMinutes = dueMacroReminderMinutes(new Date(event.event_at), new Date());
      if (reminderMinutes == null) continue;

      const { data: claimed, error: claimError } = await supabase.rpc("claim_macro_event_reminder", {
        p_event_id: event.id,
        p_reminder_minutes: reminderMinutes,
      });
      if (claimError) throw claimError;
      if (claimed !== true) continue;
      summary.remindersClaimed++;

      const location = event.currency ? ` · ${event.currency}` : "";
      const payload = createPushPayload({
        category: "macroeconomy",
        title: `Tra ${reminderMinutes} min · evento macro`,
        body: `${String(event.title).slice(0, 140)}${location}`,
        url: event.source_url || undefined,
        resourceType: "macro_event",
        resourceId: event.id,
        tag: `macro-event:${event.id}:${reminderMinutes}`,
      });

      try {
        const delivery = await sendPushNotifications(supabase, payload, { broadcast: true });
        summary.delivered += delivery.delivered;
        summary.failed += delivery.failed;
        if (delivery.attempted > 0 && delivery.failed > 0 && delivery.delivered === 0) {
          const { error: releaseError } = await supabase
            .from("macro_event_reminders")
            .delete()
            .eq("event_id", event.id)
            .eq("reminder_minutes", reminderMinutes);
          if (releaseError) throw releaseError;
        } else {
          const { error: completeError } = await supabase
            .from("macro_event_reminders")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("event_id", event.id)
            .eq("reminder_minutes", reminderMinutes);
          if (completeError) throw completeError;
        }
      } catch (sendError) {
        const { error: releaseError } = await supabase
          .from("macro_event_reminders")
          .delete()
          .eq("event_id", event.id)
          .eq("reminder_minutes", reminderMinutes);
        if (releaseError) throw releaseError;
        throw sendError;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Macro reminders] Elaborazione fallita:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Errore durante l'invio dei promemoria macro.",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
