# Aswin — Resume

Single-page resume built as a self-contained **HTML/CSS** file and rendered to PDF
with headless Chromium. No design tool, no lock-in — edit the source, push, done.

## View / download

Auto-built on every push to `main` and deployed to Cloudflare Pages.

- **View in browser:** https://resume.aswincloud.com/
- **Download PDF:** https://resume.aswincloud.com/Aswin_Resume.pdf

Pull requests get their own preview URL (posted as a PR comment) before anything
reaches production.

## Files
- `resume.html` — the resume (all styling is inline CSS). Source of truth.
- `photo.jpg` — headshot (circular crop is done in CSS).
- `build.sh` — renders `resume.html` → `Aswin_Resume.pdf` (`BROWSER=… ./build.sh` to override the browser).
- `site/index.html` — landing page that embeds the PDF for inline browser viewing.
- `.github/workflows/build.yml` — CI: renders the PDF and deploys the viewer + PDF to Cloudflare Pages (production on `main`, preview URLs on PRs).

The built PDF is **not** committed — CI renders and deploys it.

## Build locally
```bash
./build.sh          # needs Chromium as `chromium`
BROWSER=$(which google-chrome) ./build.sh   # or point at any Chrome/Chromium
```
Fonts: Liberation Sans / Liberation Sans Bold.

## Design
Navy (`#16215a`) sidebar with gold (`#c9a86b`) accents, circular photo, contact
block with inline-SVG icons, skills / education / certifications in the sidebar;
profile, an experience timeline, and projects in the main column. The sidebar
color is a split `linear-gradient` on `body` so it extends to the page edge.
Layout is tuned to fit a single A4 page.
