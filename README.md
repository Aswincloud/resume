# Aswin — Resume

Single-page resume authored as a self-contained **HTML/CSS** file and rendered to
PDF on demand by a **Cloudflare Worker** using **Browser Run** (managed headless
Chromium). No design tool, no lock-in — edit the source, push, done.

## View / download

- **View in browser:** https://resume.aswincloud.com/
- **Download PDF:** https://resume.aswincloud.com/Aswin_Resume.pdf

The Worker renders the PDF the first time a given resume version is requested,
caches it in KV, and serves the cached copy after that. Editing `resume.html`
changes the bundled HTML, which changes its content hash, which transparently
triggers a re-render on the next request.

## How it fits together

```
resume.html ──(scripts/embed.mjs: inline fonts + photo)──▶ resume.embedded.html
                                                                   │  bundled into
                                                                   ▼
GET /Aswin_Resume.pdf ─▶ Worker ─ KV hit? ─▶ serve cached PDF
                                  └ miss ──▶ Browser Run renders ─▶ cache ─▶ serve
```

Fonts are **subset + embedded** so Browser Run renders byte-for-byte what you see
locally, independent of the render container's installed fonts.

## Files
- `resume.html` — the resume (all styling is inline CSS). **Source of truth.**
- `photo.jpg` — headshot (circular crop is done in CSS).
- `fonts/` — Liberation Sans faces, subset to the glyphs the resume uses and
  converted to WOFF2 (~5 KB each). Regenerate from a full TTF only if the text
  starts using new characters.
- `scripts/embed.mjs` — inlines the fonts (base64 WOFF2) and photo into
  `resume.html`, emitting the self-contained `resume.embedded.html`.
- `src/worker.ts` — the Worker: renders via Browser Run, caches in KV, serves the
  viewer at `/` and the PDF at `/Aswin_Resume.pdf`.
- `wrangler.jsonc` — Worker config (browser binding, KV namespace, text-module rule).
- `build.sh` — local-only: renders `resume.html` → `Aswin_Resume.pdf` with your own
  Chromium, for quick offline previews. Not used in production.

`resume.embedded.html` and `Aswin_Resume.pdf` are generated artifacts and are **not**
committed.

## Develop & deploy

```bash
npm install
npm run embed          # build resume.embedded.html (fonts + photo inlined)
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

<!-- mq-manual-test -->

<!-- auto-merge-behavior-test -->
