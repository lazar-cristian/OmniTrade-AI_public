import { isAllowedPushEndpoint } from "./push-endpoint.ts";

Deno.test("allows supported push provider endpoints", () => {
  const endpoints = [
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://push-service.opera.com/notify/token",
    "https://wns2-abc.notify.windows.com/w/?token=abc",
  ];

  if (endpoints.some(endpoint => !isAllowedPushEndpoint(endpoint))) {
    throw new Error("A supported push provider endpoint was rejected.");
  }
});

Deno.test("rejects arbitrary, insecure, and credentialed endpoints", () => {
  const endpoints = [
    "http://fcm.googleapis.com/fcm/send/token",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://fcm.googleapis.com.attacker.example/",
    "https://attacker.example/",
    "https://user@fcm.googleapis.com/",
    "https://fcm.googleapis.com:8443/",
    "not-a-url",
  ];

  if (endpoints.some(isAllowedPushEndpoint)) {
    throw new Error("An invalid or untrusted push endpoint was allowed.");
  }
});
