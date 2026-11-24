import type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.2";
import * as webpush from "npm:web-push@3.6.7";
import { isAllowedPushEndpoint } from "./push-endpoint.ts";

export const PUSH_CATEGORIES = [
  "news",
  "trading_alerts",
  "macroeconomy",
  "earnings",
  "system",
  "portfolio",
  "journal",
  "backtest",
] as const;

export type PushCategory = typeof PUSH_CATEGORIES[number];

const macroKeywords = [
  "cpi", "inflation", "inflazione",
  "fed", "fomc", "powell", "interest rate", "tassi", "taglio tassi",
  "ecb", "bce", "lagarde",
  "nfp", "non-farm", "disoccupazione", "unemployment",
  "gdp", "pil",
  "war", "guerra", "missile", "escalation", "dazi", "tariff",
];

export function isMacroHeadline(title: string): boolean {
  const normalizedTitle = title.toLowerCase();
  return macroKeywords.some(keyword => normalizedTitle.includes(keyword));
}

export interface PushPayloadInput {
  category: PushCategory;
  title: string;
  body: string;
  url?: string;
  resourceType?: string;
  resourceId?: string;
  tag?: string;
}

export interface PushPayload extends PushPayloadInput {
  url: string;
  icon: string;
  badge: string;
  tag: string;
}

const viewByResourceType: Record<string, string> = {
  news: "news",
  analysis: "dashboard",
  macro_event: "news",
  strategy_alert: "dashboard",
  trading_alerts: "dashboard",
  earnings: "news",
  system: "news",
  portfolio: "portafoglio",
  journal: "diario",
  backtest: "dashboard",
};

function isSafePushUrl(url: string): boolean {
  if (url.startsWith("//")) return false;
  if (/^(?:\/|\.\/|\?)/.test(url)) return !/[\u0000-\u001f]/.test(url);
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function createPushPayload(input: PushPayloadInput): PushPayload {
  const resourceType = input.resourceType || input.category;
  const resourceId = input.resourceId || "";
  const params = new URLSearchParams({
    view: viewByResourceType[resourceType] || "news",
    resourceType,
  });
  if (resourceId) params.set("resourceId", resourceId);

  const requestedUrl = input.url?.trim() || `?${params.toString()}`;
  const url = isSafePushUrl(requestedUrl) ? requestedUrl : `?${params.toString()}`;
  const tag = input.tag?.trim().slice(0, 128)
    || `omnitrade:${input.category}:${resourceId || input.title.slice(0, 48)}`;

  return {
    ...input,
    resourceType,
    resourceId,
    url,
    tag,
    icon: "./favicon.svg",
    badge: "./push-badge.svg",
  };
}

export function configureWebPush() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@omnitrade.ai";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY devono essere configurate nei secrets Supabase.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

interface DeliveryTarget {
  userId?: string;
  broadcast?: boolean;
  excludeDeviceId?: string;
}

export async function sendPushNotifications(
  supabase: SupabaseClient,
  payload: PushPayload,
  target: DeliveryTarget,
) {
  if (!target.userId && !target.broadcast) {
    throw new Error("Indicare un destinatario o autorizzare un invio broadcast.");
  }

  const result = { attempted: 0, delivered: 0, failed: 0, removed: 0 };
  const failureStatusCodes: Record<string, number> = {};
  const staleEndpoints: string[] = [];
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth,device_id")
      .eq("enabled", true)
      .not("user_id", "is", null)
      .contains("categories", [payload.category])
      .range(offset, offset + pageSize - 1);
    if (target.userId) query = query.eq("user_id", target.userId);
    if (target.excludeDeviceId) query = query.neq("device_id", target.excludeDeviceId);

    const { data: subscriptions, error } = await query;
    if (error) throw error;
    if (!subscriptions?.length) break;

    for (let index = 0; index < subscriptions.length; index += 20) {
      const batch = subscriptions.slice(index, index + 20);
      result.attempted += batch.length;
      const outcomes = await Promise.all(batch.map(async subscription => {
        if (!isAllowedPushEndpoint(subscription.endpoint)) {
          failureStatusCodes.blocked_endpoint = (failureStatusCodes.blocked_endpoint || 0) + 1;
          console.error("[Web Push] Destinazione subscription non consentita.");
          return { type: "failed" as const };
        }
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify(payload));
          return { type: "delivered" as const };
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            return { type: "stale" as const, endpoint: subscription.endpoint };
          }
          const status = typeof statusCode === "number" ? String(statusCode) : "network";
          failureStatusCodes[status] = (failureStatusCodes[status] || 0) + 1;
          console.error("[Web Push] Invio fallito:", statusCode || "errore provider");
          return { type: "failed" as const };
        }
      }));

      for (const outcome of outcomes) {
        if (outcome.type === "delivered") result.delivered++;
        else if (outcome.type === "stale") staleEndpoints.push(outcome.endpoint);
        else result.failed++;
      }
    }

    if (subscriptions.length < pageSize) break;
  }

  if (staleEndpoints.length) {
    for (let index = 0; index < staleEndpoints.length; index += 200) {
      const batch = staleEndpoints.slice(index, index + 200);
      const { error } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", batch);
      if (error) throw error;
      result.removed += batch.length;
    }
  }

  return { ...result, failureStatusCodes };
}
