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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface NewsItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_match, code: string) => {
      const point = Number.parseInt(code, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "\uFFFD";
    })
    .replace(/&#(\d{1,7});/g, (_match, code: string) => {
      const point = Number.parseInt(code, 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "\uFFFD";
    });
}

function readTag(block: string, name: string): string {
  const expression = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, "i");
  return decodeXml(block.match(expression)?.[1]?.trim() || "");
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = readTag(block, "title");
    const link = readTag(block, "link");
    const id = readTag(block, "guid") || link || title;
    const published = readTag(block, "pubDate");
    const publishedTime = published ? Date.parse(published) : NaN;
    if (title && id) {
      items.push({
        id,
        title,
        link,
        publishedAt: Number.isFinite(publishedTime) ? new Date(publishedTime).toISOString() : null,
      });
    }
  }
  return items;
}

function toSentRow(item: NewsItem) {
  return {
    news_id: item.id,
    title: item.title,
    source_url: item.link || null,
    published_at: item.publishedAt,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo non supportato." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (req.headers.get("Authorization") !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({ error: "Operazione riservata al servizio interno." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    configureWebPush();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const response = await fetch("https://www.investing.com/rss/news.rss", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OmniTradeAI/1.0)" },
    });
    if (!response.ok) throw new Error(`Lettura feed News fallita (HTTP ${response.status}).`);

    const items = parseRss(await response.text());
    if (!items.length) throw new Error("Il feed News non contiene articoli validi.");

    const { count, error: countError } = await supabase
      .from("news_push_sent")
      .select("news_id", { count: "exact", head: true });
    if (countError) throw countError;
    if (count === 0) {
      const { error } = await supabase
        .from("news_push_sent")
        .upsert(items.map(toSentRow), { onConflict: "news_id", ignoreDuplicates: true });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, initialized: true, delivered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: knownItems, error: knownError } = await supabase
      .from("news_push_sent")
      .select("news_id")
      .in("news_id", items.map(item => item.id));
    if (knownError) throw knownError;
    const knownIds = new Set((knownItems || []).map(item => item.news_id));
    const newItems = items.filter(item => !knownIds.has(item.id));
    const macroItems = newItems.filter(item => isMacroHeadline(item.title));
    const newsToSend = newItems.filter(item => !isMacroHeadline(item.title)).slice(0, 5);
    const failedNewsIds = new Set<string>();
    let delivered = 0;
    let failed = 0;

    for (const item of newsToSend) {
      const payload = createPushPayload({
        category: "news",
        title: "OmniTrade AI — News",
        body: item.title,
        url: item.link || undefined,
        resourceType: "news",
        resourceId: item.id,
        tag: `news:${item.id}`,
      });
      const result = await sendPushNotifications(supabase, payload, { broadcast: true });
      delivered += result.delivered;
      failed += result.failed;
      if (result.failed) failedNewsIds.add(item.id);
    }

    const processedItems = [
      ...macroItems,
      ...newsToSend.filter(item => !failedNewsIds.has(item.id)),
    ];
    if (processedItems.length) {
      const { error } = await supabase
        .from("news_push_sent")
        .upsert(processedItems.map(toSentRow), { onConflict: "news_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    return new Response(JSON.stringify({
      ok: true,
      discovered: newItems.length,
      newsAttempted: newsToSend.length,
      pending: newItems.length - processedItems.length,
      delivered,
      failed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Web Push News] Elaborazione fallita:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Errore durante l'invio News Push.",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
