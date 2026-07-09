# Aswin — Resume

Single-page resume built as a self-contained **HTML/CSS** file and rendered to PDF
with headless Chromium. No design tool, no lock-in — edit the source, rebuild.

## Files
- `resume.html` — the resume (all styling is inline CSS). This is the source of truth.
- `photo.jpg` — headshot (circular crop is done in CSS).
- `build.sh` — renders `resume.html` → `Aswin_Resume.pdf`.
- `Aswin_Resume.pdf` — latest rendered output.

## Build
```bash
./build.sh
```
Requires Chromium (`chromium` or `chromium-browser`). Fonts: Liberation Sans /
Liberation Sans Bold.

## Design
Navy (`#16215a`) sidebar with gold (`#c9a86b`) accents, circular photo, contact
block with inline-SVG icons, skills / education / certifications in the sidebar;
profile, an experience timeline, and projects in the main column. The sidebar
color is a split `linear-gradient` on `body` so it extends to the page edge and
across pages when printing.
