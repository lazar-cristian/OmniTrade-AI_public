// supabase/functions/macro-push-alerts/index.ts
//
// Edge Function periodica (chiamata via pg_cron ogni 5 minuti o via webhook).
// Controlla le ultime notizie macroeconomiche, filtra quelle importanti
// (CPI, NFP, Fed, BCE, Tassi, Inflazione, Guerre, ecc.), registra quelle
// già inviate nella tabella 'macro_news_inviate' e invia Web Push a tutte le
// iscrizioni registrate in 'push_subscriptions'.
//
// Secrets richiesti su Supabase:
//   supabase secrets set VAPID_PRIVATE_KEY="..."
//   supabase secrets set VAPID_PUBLIC_KEY="..."
//   supabase secrets set VAPID_SUBJECT="mailto:support@omnitrade.ai"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@omnitrade.ai";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Parole chiave macro ad alto impatto per il mercato
const PAROLE_CHIAVE = [
  "cpi", "inflation", "inflazione",
  "fed", "fomc", "powell", "interest rate", "tassi", "taglio tassi",
  "ecb", "bce", "lagarde",
  "nfp", "non-farm", "disoccupazione", "unemployment",
  "gdp", "pil",
  "war", "guerra", "missile", "escalation", "dazi", "tariff"
];

function isNotiziaImportante(titolo: string): boolean {
  const t = titolo.toLowerCase();
  return PAROLE_CHIAVE.some((k) => t.includes(k));
}

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
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ errore: "Chiavi VAPID non configurate nei secrets di Supabase." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

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
    const importanti = notizie.filter((n) => isNotiziaImportante(n.title));
    if (importanti.length === 0) {
      return new Response(JSON.stringify({ messaggio: "Nessuna notizia ad alto impatto trovata." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Controlla quali sono già state inviate
    const ids = importanti.map((n) => n.id);
    const { data: giaInviate } = await supabase
      .from("macro_news_inviate")
      .select("news_id")
      .in("news_id", ids);

    const giaInviateSet = new Set((giaInviate || []).map((r: { news_id: string }) => r.news_id));
    const daInviare = importanti.filter((n) => !giaInviateSet.has(n.id));

    if (daInviare.length === 0) {
      return new Response(JSON.stringify({ messaggio: "Tutte le notizie importanti sono già state inviate." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Prendi tutte le iscrizioni push attive
    const { data: subs, error: subErr } = await supabase.from("push_subscriptions").select("*");
    if (subErr) throw subErr;

    if (!subs || subs.length === 0) {
      // Salva comunque come già processate per evitare spam successivo
      for (const item of daInviare) {
        await supabase.from("macro_news_inviate").insert({ news_id: item.id, titolo: item.title });
      }
      return new Response(JSON.stringify({ messaggio: "Nessun utente iscritto alle notifiche push.", notizie: daInviare.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Invia Web Push per ciascuna notizia a ciascun iscritto
    let inviateConSuccesso = 0;
    const subsDaRimuovere: string[] = [];

    for (const notizia of daInviare) {
      const payload = JSON.stringify({
        title: "⚡ OmniTrade AI — Flash Macro",
        body: notizia.title,
        url: notizia.link || "/",
      });

      for (const sub of subs) {
        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };
          await webpush.sendNotification(pushSubscription, payload);
          inviateConSuccesso++;
        } catch (err: any) {
          // Se la sottoscrizione è scaduta (410 o 404), la segniamo per rimozione
          if (err.statusCode === 410 || err.statusCode === 404) {
            subsDaRimuovere.push(sub.endpoint);
          }
        }
      }

      // Segna notizia come inviata
      await supabase.from("macro_news_inviate").insert({ news_id: notizia.id, titolo: notizia.title });
    }

    // Pulisci le iscrizioni scadute
    if (subsDaRimuovere.length > 0) {
      await supabase.from("push_subscriptions").delete().in("endpoint", subsDaRimuovere);
    }

    return new Response(
      JSON.stringify({
        messaggio: "Processo completato con successo",
        notizieInviate: daInviare.length,
        notificheConsegnate: inviateConSuccesso,
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
