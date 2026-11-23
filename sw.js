// Service Worker per notifiche Web Push di OmniTrade AI
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let payload = {
        title: 'OmniTrade AI — Alert Macro',
        body: 'Nuova notizia macroeconomica ad alto impatto.',
        icon: 'https://cdn-icons-png.flaticon.com/512/2534/2534204.png',
        url: '/'
    };

    if (event.data) {
        try {
            payload = Object.assign(payload, event.data.json());
        } catch (e) {
            payload.body = event.data.text();
        }
    }

    const opzioni = {
        body: payload.body,
        icon: payload.icon || 'https://cdn-icons-png.flaticon.com/512/2534/2534204.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/2534/2534204.png',
        vibrate: [200, 100, 200],
        data: {
            url: payload.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, opzioni)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const urlDaAprire = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlDaAprire);
            }
        })
    );
});
