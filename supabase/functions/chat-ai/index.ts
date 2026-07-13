// supabase/functions/chat-ai/index.ts
//
// Edge Function che fa da intermediario sicuro tra il browser e OpenRouter.
// La chiave OPENROUTER_API_KEY resta SOLO qui (impostata come secret su
// Supabase), non è mai visibile nel codice del sito o nel browser.
//
// Per impostazione predefinita, Supabase verifica automaticamente il JWT
// dell'utente prima di eseguire questa funzione (verify_jwt = true): solo
// chi ha fatto login sul sito può usarla. Non serve altro codice per quello.

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "meta-llama/llama-3.1-8b-instruct:free";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ errore: "OPENROUTER_API_KEY non configurata come secret su Supabase (supabase secrets set OPENROUTER_API_KEY=...)." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { messaggio, storico } = await req.json();
    if (!messaggio || typeof messaggio !== "string") {
      return new Response(
        JSON.stringify({ errore: "Campo 'messaggio' mancante o non valido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const messaggiChat = [
      {
        role: "system",
        content:
          "Sei l'AI Copilot di OmniTrade, un assistente di trading quantitativo esperto nella Liquidity Auction " +
          "Theory di Andrea Cimi (Order Flow, VWAP, Mean Reversion, Volume Tick, Assorbimento, Smart Money). " +
          "Rispondi sempre in italiano, in modo tecnico ma chiaro e sintetico. Non fornire mai consigli finanziari " +
          "personalizzati o garanzie di profitto: offri solo analisi didattica e spiegazioni concettuali.",
      },
      ...(Array.isArray(storico) ? storico.slice(-6) : []),
      { role: "user", content: messaggio },
    ];

    const risposta = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: messaggiChat,
        max_tokens: 600,
      }),
    });

    if (!risposta.ok) {
      const testoErrore = await risposta.text();
      return new Response(
        JSON.stringify({ errore: `OpenRouter ha risposto con errore ${risposta.status}: ${testoErrore}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dati = await risposta.json();
    const testoRisposta = dati?.choices?.[0]?.message?.content ?? "Nessuna risposta generata dal modello.";

    return new Response(JSON.stringify({ risposta: testoRisposta }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ errore: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
