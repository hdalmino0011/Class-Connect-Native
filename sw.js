/* =========================================================
   ClassConnect — Service Worker
   Cache-first with network fallback
   ========================================================= */

const CACHE_NAME = "classconnect-cache-v1";

const ASSETS_TO_CACHE = [
  "index.html",
  "style.css",
  "script.js",
  "manifest.json",
  "logo.png"
];

// Install: pre-cache core app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        // If an asset is missing, don't block install.
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first, fallback to network, fallback to cached index.html for navigation
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          // Cache new same-origin assets on the fly
          if (event.request.url.startsWith(self.location.origin)) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback for page navigations
          if (event.request.mode === "navigate") {
            return caches.match("index.html");
          }
        });
    })
  );
});

// =========================================================
// PUSH & NOTIFICATION EVENTS FOR FULL DEVICE INTERACTION
// =========================================================

// Handle message from client application (e.g. trigger native notification)
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (event.data.type === "SHOW_NOTIFICATION") {
    const title = event.data.title || "ClassConnect Alert";
    const options = Object.assign({
      icon: "logo.png",
      badge: "logo.png",
      vibrate: [150, 80, 150],
      requireInteraction: false,
      data: {}
    }, event.data.options || {});

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// Handle incoming Web Push
self.addEventListener("push", (event) => {
  let payload = { title: "ClassConnect Notification", body: "You have an update in ClassConnect", view: "view-home" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const notificationOptions = {
    body: payload.body || "Check your subjects, tasks, and posts.",
    icon: payload.icon || "logo.png",
    badge: payload.badge || "logo.png",
    vibrate: [200, 100, 200],
    data: {
      url: payload.url || "./index.html",
      view: payload.view || "view-home",
      extra: payload.extra || null
    },
    actions: payload.actions || [
      { action: "open", title: "Open App" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "ClassConnect", notificationOptions)
  );
});

// Handle Notification Clicks (Focus app or open view directly)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetView = (event.notification.data && event.notification.data.view) || "view-home";
  const targetAction = event.action || "open";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If there's an open window, focus it and post a navigation message
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if ("focus" in client) {
          client.focus();
          client.postMessage({
            type: "NAVIGATE_VIEW",
            view: targetView,
            action: targetAction,
            data: event.notification.data
          });
          return client;
        }
      }
      // If no window is open, open a new one with a view param
      if (clients.openWindow) {
        return clients.openWindow("./index.html?view=" + encodeURIComponent(targetView));
      }
    })
  );
});

