import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import {
  configureWebPush,
  createPushPayload,
  PUSH_CATEGORIES,
  sendPushNotifications,
  type PushCategory,
} from "../_shared/push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    if (!publicKey) {
      return new Response(JSON.stringify({ error: "VAPID_PUBLIC_KEY non configurata." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    return new Response(JSON.stringify({ publicKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo non supportato." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const input = await req.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return new Response(JSON.stringify({ error: "Il body deve essere un oggetto JSON valido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isServiceRole = !!SUPABASE_SERVICE_ROLE_KEY && authorization === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    let userId: string | undefined;
    if (!isServiceRole) {
      const token = authorization.replace(/^Bearer\s+/i, "");
      if (!token || !SUPABASE_ANON_KEY) {
        return new Response(JSON.stringify({ error: "Autenticazione richiesta." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: { user }, error } = await authClient.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Sessione utente non valida." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (input?.test !== true) {
        return new Response(JSON.stringify({ error: "Gli utenti possono inviare solo una notifica di test ai propri dispositivi." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    if (!isServiceRole) {
      configureWebPush();
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const payload = createPushPayload({
        category: "system",
        title: "OmniTrade AI — Push attivo",
        body: "Questa è una notifica Web Push di prova.",
        resourceType: "system",
        resourceId: "push-test",
        tag: `system:push-test:${userId}`,
      });
      const result = await sendPushNotifications(supabase, payload, { userId });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!PUSH_CATEGORIES.includes(input?.category as PushCategory)) {
      return new Response(JSON.stringify({ error: "Categoria push non valida." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 120
      || typeof input.body !== "string" || !input.body.trim() || input.body.length > 1500) {
      return new Response(JSON.stringify({ error: "Titolo o testo notifica non valido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (input.url != null && (typeof input.url !== "string" || input.url.length > 2048)) {
      return new Response(JSON.stringify({ error: "URL della notifica non valido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (input.resourceId != null && (typeof input.resourceId !== "string" || input.resourceId.length > 256)) {
      return new Response(JSON.stringify({ error: "Identificativo risorsa non valido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (input.userId != null && !isUuid(input.userId)) {
      return new Response(JSON.stringify({ error: "Destinatario non valido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (input.broadcast === true && input.userId) {
      return new Response(JSON.stringify({ error: "Scegli un utente specifico o un broadcast." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!input.userId && input.broadcast !== true) {
      return new Response(JSON.stringify({ error: "Indicare userId o broadcast: true." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    configureWebPush();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = createPushPayload({
      category: input.category,
      title: input.title.trim(),
      body: input.body.trim(),
      url: input.url,
      resourceType: typeof input.resourceType === "string" ? input.resourceType.slice(0, 64) : undefined,
      resourceId: input.resourceId,
      tag: typeof input.tag === "string" ? input.tag : undefined,
    });
    const result = await sendPushNotifications(supabase, payload, {
      userId: input.userId,
      broadcast: input.broadcast === true,
    });

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Web Push] Dispatch fallito:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Errore interno durante l'invio push.",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
