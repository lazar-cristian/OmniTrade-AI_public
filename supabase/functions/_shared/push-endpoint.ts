const allowedPushEndpointHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "push-service.opera.com",
]);

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && (allowedPushEndpointHosts.has(host) || host.endsWith(".notify.windows.com"));
  } catch {
    return false;
  }
}
