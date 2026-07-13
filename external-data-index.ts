// supabase/functions/external-data/index.ts
//
// Intermediario server-side per dati esterni (Yahoo Finance, RSS di
// Investing.com) che il browser non può chiamare direttamente per via
// del CORS. Un fetch fatto da qui (server-to-server) non è mai soggetto
// alle restrizioni CORS del browser, quindi sostituisce in modo affidabile
// i proxy pubblici di terzi (allorigins.win ecc.) usati in precedenza.
//
// Deploy pubblico (nessun login richiesto, sono solo dati di mercato):
//   supabase functions deploy external-data --no-verify-jwt

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function rispostaErrore(messaggio: string, status = 400) {
  return new Response(JSON.stringify({ errore: messaggio }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const tipo = url.searchParams.get("tipo");

    if (tipo === "yahoo") {
      const ticker = url.searchParams.get("ticker");
      const interval = url.searchParams.get("interval") || "1d";
      const range = url.searchParams.get("range") || "1mo";
      if (!ticker) return rispostaErrore("Parametro 'ticker' mancante.");

      const yahooUrl =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
        `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

      const r = await fetch(yahooUrl, { headers: { "User-Agent": USER_AGENT } });
      const testo = await r.text();
      return new Response(testo, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tipo === "investing-news") {
      const feed = url.searchParams.get("feed") || "https://www.investing.com/rss/news.rss";
      const r = await fetch(feed, { headers: { "User-Agent": USER_AGENT } });
      const testo = await r.text();
      return new Response(testo, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      });
    }

    return rispostaErrore("Parametro 'tipo' mancante o non valido (usa 'yahoo' oppure 'investing-news').");
  } catch (e) {
    return rispostaErrore(String(e), 500);
  }
});
