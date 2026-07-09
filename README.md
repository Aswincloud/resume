# Aswin — Resume

Single-page resume built as a self-contained **HTML/CSS** file and rendered to PDF
with headless Chromium. No design tool, no lock-in — edit the source, push, done.

## Download

Latest PDF (auto-built on every push to `main`):

**https://github.com/Aswincloud/resume/releases/latest/download/Aswin_Resume.pdf**

## Files
- `resume.html` — the resume (all styling is inline CSS). Source of truth.
- `photo.jpg` — headshot (circular crop is done in CSS).
- `build.sh` — renders `resume.html` → `Aswin_Resume.pdf` (`BROWSER=… ./build.sh` to override the browser).
- `.github/workflows/build.yml` — CI: renders the PDF and attaches it to the rolling `latest` release.

The built PDF is **not** committed — CI is the source of the artifact (see the release link above).

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
color is a split `linear-gradient` on `body` so it extends to the page edge and
across pages when printing.
