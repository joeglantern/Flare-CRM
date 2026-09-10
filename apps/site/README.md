# The marketing site

Static HTML and CSS at `flarehub.co.ke`. No framework, no build step: what is in `public/` is what
is served, so a `git pull` on the host is the deployment.

```
public/
  assets/base.css   tokens, fonts and reset, ported from packages/ui (do not diverge)
  fonts/            Inter Variable and Geist Mono Variable, self-hosted
  brand/            symlinked at deploy time from apps/web/public/brand
  shots/            product screenshots, copied from apps/web/public/help
```

Serving is `infra/site/site.caddy` plus the `infra/site/caddy.yml` overlay, which mounts this
directory into whichever Caddy is on the host. Set `SITE_DOMAIN` in `infra/docker/.env`.

The design lives in `docs/design/Marketing Site.dc.html` and is the visual and copy specification.
The three legal pages take their text verbatim from `apps/web/src/features/legal/`; that copy is
published on every customer's CRM as well, and the two must not drift.

## Checking it

`apps/web/scripts/check-site.mjs` loads every page in a real browser at desktop and phone width and
reports only what is wrong: horizontal overflow, a skipped heading level, a missing alt or missing
dimensions, an image that failed to decode, and any request that came back 400 or worse. It lives
in `apps/web` because that is where Playwright already is.

```
cd apps/site/public && python -m http.server 8099
node apps/web/scripts/check-site.mjs [--shots]
```

## Product shots

`apps/web/public/help` holds every figure in both themes: light as AVIF, WebP and PNG, dark as AVIF
and WebP. There is deliberately no dark PNG, because nothing can request it: a browser that
supports neither AVIF nor WebP is a browser from before either theme swap existed, and it gets the
light PNG as the `<img>` fallback.

Theme-matched shots, working with no JavaScript:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" type="image/avif" srcset="/shots/inbox-dark.avif" />
  <source media="(prefers-color-scheme: dark)" type="image/webp" srcset="/shots/inbox-dark.webp" />
  <source type="image/avif" srcset="/shots/inbox-light.avif" />
  <source type="image/webp" srcset="/shots/inbox-light.webp" />
  <img src="/shots/inbox-light.png" width="1280" height="800" loading="lazy" alt="..." />
</picture>
```

That follows the system theme on its own. The toolbar toggle is a manual override of the system
preference, and `<picture>` cannot see a `data-theme` attribute, so the toggle swaps the `srcset`
in script. Without JavaScript the toggle is absent and every shot still matches the theme the
visitor's system asked for.
