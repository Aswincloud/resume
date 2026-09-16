# Aswin — Resume

Single-page resume authored as a self-contained **HTML/CSS** file and rendered to
PDF on demand by a **Cloudflare Worker** using **Browser Run** (managed headless
Chromium). No design tool, no lock-in — edit the source, push, done.

## View / download

- **View in browser:** https://resume.aswincloud.com/
- **Download PDF:** https://resume.aswincloud.com/Aswin_Resume.pdf
- **Other themes:** https://resume.aswincloud.com/themes — same content, different
  layouts. Switch with the picker in the top bar or the ← / → keys. Each theme
  has its own page at `/themes/<id>` and PDF at `/themes/<id>/Aswin_Resume.pdf`.

The Worker renders a PDF the first time a given theme version is requested,
caches it in KV, and serves the cached copy after that. Editing a theme changes
its bundled HTML, which changes its content hash, which transparently triggers
a re-render on the next request. Other themes keep their cached PDFs.

## How it fits together

```
resume.html + themes/*.html ──(scripts/embed.mjs)──▶ themes.embedded.json
                                                     (raw theme HTML + one copy
                                                      of fonts and photo)
                                                              │  bundled into
                                                              ▼
GET /themes/<id>/Aswin_Resume.pdf ─▶ Worker ─ splice fonts+photo into theme
                                          ─ KV hit? ─▶ serve cached PDF
                                          └ miss ──▶ Browser Run renders ─▶ cache ─▶ serve
```

Fonts are **subset + embedded** so Browser Run renders byte-for-byte what you see
locally, independent of the render container's installed fonts. They and the
photo are shipped once and spliced into a theme at request time rather than
inlined into every theme at build time — the photo is ~1.2 MB and ten themes
use it.

## Themes

`resume.html` is the default theme (id `navy`); every other layout lives in
`themes/NN-<id>.html`, and the numeric prefix sets the order in the picker. A
theme is a complete, standalone A4 page — same content as `resume.html`, its
own CSS — that declares its metadata in `<head>`:

```html
<meta name="theme-name" content="Swiss / Minimal">
<meta name="theme-description" content="Full-width single column, one warm accent, …">
```

`scripts/embed.mjs` refuses to build a theme that lacks those tags or that does
not contain exactly one literal `<head>`, `<body>` and `<style>` (that is where
the Worker injects fonts and the web chrome). Reference the photo as
`src="photo.jpg"` and use `"Liberation Sans"` in a font stack to get the
embedded faces; themes may also `@import` Google Fonts, which Browser Run
fetches at render time.

To add a theme: drop the file in `themes/`, `npm run embed`, and check it at
`/themes/<id>` with `npm run dev`. Nothing else to register.

**Editing content** means editing it in every theme — there is no shared data
file yet, each theme carries its own copy of the text.

## Files
- `resume.html` — the resume in the default theme (all styling is inline CSS). **Source of truth.**
- `themes/` — the other layouts, one self-contained HTML file each (see Themes).
- `photo.jpg` — headshot (circular crop is done in CSS).
- `fonts/` — Liberation Sans faces, subset to the glyphs the resume uses and
  converted to WOFF2 (~5 KB each). Regenerate from a full TTF only if the text
  starts using new characters.
- `scripts/embed.mjs` — collects every theme plus the fonts (base64 WOFF2) and
  photo into `themes.embedded.json`, and validates each theme's metadata.
- `src/worker.ts` — the Worker: renders via Browser Run, caches in KV, serves the
  default theme at `/` and `/Aswin_Resume.pdf`, the others at `/themes/<id>`
  and `/themes/<id>/Aswin_Resume.pdf`, and the index at `/themes`.
- `wrangler.jsonc` — Worker config (browser binding, KV namespace, text-module rule).
- `build.sh` — local-only: renders `resume.html` (or a theme file passed as the
  first argument) → `Aswin_Resume.pdf` with your own Chromium, for quick offline
  previews. Not used in production.

`themes.embedded.json` and `Aswin_Resume.pdf` are generated artifacts and are **not**
committed.

## Develop & deploy

```bash
npm install
npm run embed          # build themes.embedded.json (all themes + fonts + photo)
npm run dev            # wrangler dev — local Worker (Browser Run runs remotely)
npm run deploy         # embed + wrangler deploy
```

Deploys are wired through **Cloudflare Workers' Git integration**: push to `main`
deploys production (`resume.aswincloud.com`), and pull requests get their own
preview URL automatically — no GitHub Actions for deploys.

The only workflow in the repo is `.github/workflows/auto-approve.yml`, which
auto-approves admin PRs; it plays no part in building or deploying the resume.

### One-time setup
1. Create a KV namespace and put its id in `wrangler.jsonc` (`PDF_CACHE` binding).
2. Enable the **Browser Run** binding on the Worker.
3. In the Cloudflare dashboard, connect this repo (Workers & Pages → Builds) with
   build command `npm run deploy`.
4. Add the custom domain `resume.aswincloud.com` to the Worker.

### Local PDF preview without Cloudflare
```bash
BROWSER=$(which google-chrome) ./build.sh   # or any Chrome/Chromium
```
Uses your local browser; needs Liberation Sans installed.

## Design
Navy (`#16215a`) sidebar with gold (`#c9a86b`) accents, circular photo, contact
block with inline-SVG icons, skills / education / certifications in the sidebar;
profile, an experience timeline, and projects in the main column. The sidebar
color is a split `linear-gradient` on `body` so it extends to the page edge.
Layout is tuned to fit a single A4 page.
