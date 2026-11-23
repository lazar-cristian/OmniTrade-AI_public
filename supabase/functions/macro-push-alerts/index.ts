// supabase/functions/macro-push-alerts/index.ts
//
// Edge Function periodica (chiamata via pg_cron ogni 5 minuti o via webhook).
// Controlla le ultime notizie macroeconomiche, filtra quelle importanti
// (CPI, NFP, Fed, BCE, Tassi, Inflazione, Guerre, ecc.), registra quelle
// già elaborate nella tabella 'macro_news_sent' e invia Web Push
// ai dispositivi attivi iscritti alla categoria 'macroeconomy'.
//
// Secrets richiesti su Supabase:
//   supabase secrets set VAPID_PRIVATE_KEY="..."
//   supabase secrets set VAPID_PUBLIC_KEY="..."
//   supabase secrets set VAPID_SUBJECT="mailto:support@omnitrade.ai"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  configureWebPush,
  createPushPayload,
  isMacroHeadline,
  sendPushNotifications,
} from "../_shared/push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function estraiTitoliRss(xmlText: string): Array<{ id: string; title: string; link: string }> {
  const items: Array<{ id: string; title: string; link: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemBlock = match[1];
    const titleMatch = itemBlock.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemBlock.match(/<title>(.*?)<\/title>/i);
    const guidMatch = itemBlock.match(/<guid.*?>(.*?)<\/guid>/i) || itemBlock.match(/<link>(.*?)<\/link>/i);
    const linkMatch = itemBlock.match(/<link>(.*?)<\/link>/i);

    const title = titleMatch ? titleMatch[1].trim() : "";
    const id = guidMatch ? guidMatch[1].trim() : title;
    const link = linkMatch ? linkMatch[1].trim() : "";

    if (title) items.push({ id, title, link });
  }
  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({ errore: "Operazione riservata al servizio interno." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    configureWebPush();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Recupera il feed notizie (Investing.com RSS come default)
    const feedUrl = "https://www.investing.com/rss/news.rss";
    const resRss = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!resRss.ok) {
      throw new Error(`Impossibile leggere il feed RSS (status ${resRss.status})`);
    }

    const xml = await resRss.text();
    const notizie = estraiTitoliRss(xml);

    // 2. Filtra notizie importanti
    const importanti = notizie.filter((n) => isMacroHeadline(n.title));
    if (importanti.length === 0) {
      return new Response(JSON.stringify({ messaggio: "Nessuna notizia ad alto impatto trovata." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Controlla quali sono già state inviate
    const ids = importanti.map((n) => n.id);
    const { data: giaInviate, error: erroreGiaInviate } = await supabase
      .from("macro_news_sent")
      .select("news_id")
      .in("news_id", ids);
    if (erroreGiaInviate) throw erroreGiaInviate;

    const giaInviateSet = new Set((giaInviate || []).map((r: { news_id: string }) => r.news_id));
    const daInviare = importanti.filter((n) => !giaInviateSet.has(n.id));

    if (daInviare.length === 0) {
      return new Response(JSON.stringify({ messaggio: "Tutte le notizie importanti sono già state inviate." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Invia solo ai dispositivi attivi iscritti alla categoria macroeconomia
    let inviateConSuccesso = 0;
    let inviiFalliti = 0;
    let notizieProcessate = 0;

    for (const notizia of daInviare) {
      const payload = createPushPayload({
        category: "macroeconomy",
        title: "OmniTrade AI — Flash Macro",
        body: notizia.title,
        url: notizia.link || undefined,
        resourceType: "macro_event",
        resourceId: notizia.id,
        tag: `macro:${notizia.id}`,
      });
      const delivery = await sendPushNotifications(supabase, payload, { broadcast: true });
      inviateConSuccesso += delivery.delivered;
      inviiFalliti += delivery.failed;

      if (delivery.failed === 0) {
        const { error: erroreInserimento } = await supabase
          .from("macro_news_sent")
          .upsert({
            news_id: notizia.id,
            title: notizia.title,
            source_url: notizia.link || null,
          }, { onConflict: "news_id", ignoreDuplicates: true });
        if (erroreInserimento) throw erroreInserimento;
        notizieProcessate++;
      }
    }

    return new Response(
      JSON.stringify({
        messaggio: "Processo completato con successo",
        notizieProcessate,
        notizieInAttesa: daInviare.length - notizieProcessate,
        notificheConsegnate: inviateConSuccesso,
        inviiFalliti,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ errore: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
