# PWA setup notes

What's new: the `/admin` section is now installable as a Progressive Web
App. On Android (Chrome) and desktop Chrome you'll get an "Install app"
button in the admin nav. On iOS Safari you'll see "Install app" with a
hint pointing to the Share → Add to Home Screen flow (iOS doesn't allow
programmatic install).

## How to install

### On your phone

1. Visit `https://www.foundinalabama.com/admin/ebay` in your phone's
   browser. Sign in if needed.
2. Look for **Install app** in the admin nav (top-right corner).
3. Tap it and confirm. The app installs to your home screen with the
   Found in Alabama logo. Opening it skips the browser chrome and
   launches into `/admin`.

### On iOS specifically

iOS requires a manual step: **Share** → **Add to Home Screen**. The
"Install app" button in the nav is just a reminder pointing at that
flow.

## Replacing the icon

The manifest currently uses `public/logo.png` as the app icon at all
sizes. That works but the icon may look slightly fuzzy on devices that
expect a high-resolution version (most Android phones request 192px or
512px).

For a sharp icon at every size:

1. Save a 512×512 PNG of your logo to `public/logo-512.png`.
2. Save a 192×192 PNG to `public/logo-192.png`.
3. Edit `app/manifest.ts` and replace the two icon entries to point at
   those files.

You can generate the smaller PNG from the 512px version using any image
editor (Preview on Mac, Paint on Windows, or online tools like
https://realfavicongenerator.net which generates a full set in one shot).

## Offline behavior

A service worker (`public/sw.js`) caches the admin shell and static
assets. If your phone goes offline, opening the app from the home
screen still loads the last-cached `/admin` page. API calls (`/api/*`)
intentionally don't cache — eBay data must always be fresh.

The cache invalidates automatically on each new deploy.

## Troubleshooting

- **The Install button doesn't appear** — Chrome only shows it after a
  brief engagement period and only on HTTPS sites that pass all PWA
  criteria. If you've visited the page once and the button hasn't
  appeared after a few seconds, refresh the page; sometimes it surfaces
  on the second load.
- **Already installed** — if the app is already installed on this
  device, the button is hidden. Uninstall the existing copy from your
  home screen first if you want to re-test the flow.
- **Service worker stuck on old version** — open Chrome DevTools →
  Application → Service Workers → Unregister, then refresh. After a
  Vercel deploy, the new SW takes effect on the next page load.
