const CATEGORY_VIEWS = {
    news: 'news',
    trading_alerts: 'dashboard',
    macroeconomy: 'news',
    earnings: 'news',
    system: 'news'
};

self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

function getNotificationUrl(data = {}) {
    if (typeof data.url === 'string' && data.url.trim()) {
        try {
            const url = new URL(data.url, self.registration.scope);
            if (url.protocol === 'https:') return url.href;
        } catch (_) {}
    }

    const params = new URLSearchParams({
        view: CATEGORY_VIEWS[data.category] || CATEGORY_VIEWS[data.resourceType] || 'news'
    });
    if (data.resourceType) params.set('resourceType', data.resourceType);
    if (data.resourceId) params.set('resourceId', data.resourceId);
    return new URL(`?${params.toString()}`, self.registration.scope).href;
}

function resolveNotificationAsset(asset, fallback) {
    try {
        const url = new URL(asset || fallback, self.registration.scope);
        return url.protocol === 'https:' ? url.href : new URL(fallback, self.registration.scope).href;
    } catch (_) {
        return new URL(fallback, self.registration.scope).href;
    }
}

self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let payload = {};
        if (event.data) {
            try {
                payload = event.data.json();
            } catch (_) {
                payload.body = event.data.text();
            }
        }

        const category = payload.category || 'system';
        const resourceType = payload.resourceType || category;
        const resourceId = payload.resourceId || '';
        const notificationUrl = getNotificationUrl({ ...payload, category, resourceType, resourceId });
        const isMobile = /Android|iPhone|iPad|iPod/i.test(self.navigator.userAgent || '');
        const notificationOptions = {
            body: payload.body || 'Hai un nuovo aggiornamento da OmniTrade AI.',
            icon: resolveNotificationAsset(payload.icon, './favicon.svg'),
            badge: resolveNotificationAsset(payload.badge, './push-badge.svg'),
            tag: payload.tag || `omnitrade:${category}:${resourceId || 'update'}`,
            renotify: false,
            timestamp: Number.isFinite(Number(payload.timestamp)) ? Number(payload.timestamp) : Date.now(),
            vibrate: isMobile ? [120, 60, 120] : undefined,
            data: {
                url: notificationUrl,
                category,
                resourceType,
                resourceId
            }
        };

        await self.registration.showNotification(payload.title || 'OmniTrade AI', notificationOptions);
        if ('setAppBadge' in self.navigator) {
            try {
                const notifications = await self.registration.getNotifications();
                await self.navigator.setAppBadge(notifications.length || 1);
            } catch (_) {}
        }
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = getNotificationUrl(event.notification.data);

    event.waitUntil((async () => {
        if ('clearAppBadge' in self.navigator) {
            try {
                await self.navigator.clearAppBadge();
            } catch (_) {}
        }

        const target = new URL(targetUrl);
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const matchingClient = windows.find(client => {
            try {
                return new URL(client.url).origin === target.origin;
            } catch (_) {
                return false;
            }
        });

        if (matchingClient) {
            if (matchingClient.url === target.href) return matchingClient.focus();
            try {
                const navigatedClient = await matchingClient.navigate(target.href);
                if (navigatedClient) return navigatedClient.focus();
            } catch (_) {}
        }
        return self.clients.openWindow(target.href);
    })());
});
