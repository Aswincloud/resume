#!/usr/bin/env node
// Bundle every resume theme into one JSON module for the Worker.
//
// Output: themes.embedded.json
//   {
//     fontFaceCss: "<@font-face rules with base64 WOFF2>",
//     photoDataUri: "data:image/jpeg;base64,...",
//     themes: [ { id, name, description, file, isDefault, html }, ... ]
//   }
//
// Themes are `resume.html` (the default) plus every `themes/*.html`, ordered by
// filename (`01-swiss-minimal.html`, `02-dark-tech.html`, ...). Each theme
// declares its own metadata in <head>:
//
//   <meta name="theme-name" content="Swiss / Minimal">
//   <meta name="theme-description" content="Full-width single column, ...">
//
// The theme id is the filename minus its numeric prefix and extension
// (`themes/07-bauhaus.html` -> `bauhaus`); the default is `navy`.
//
// Fonts and the photo are shipped ONCE, not inlined into every theme: the
// photo alone is ~1.2 MB, and ten themes use it. The Worker splices them into a
// theme's HTML at request time (see src/worker.ts), so local and prod still
// render byte-for-byte the same fonts, independent of the render container.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (p) => readFileSync(join(root, p)).toString("base64");

const fonts = {
  regular: b64("fonts/LiberationSans-Regular.woff2"),
  bold: b64("fonts/LiberationSans-Bold.woff2"),
  italic: b64("fonts/LiberationSans-Italic.woff2"),
};

const fontFaceCss = `
  @font-face{ font-family:"Liberation Sans"; font-style:normal; font-weight:400;
    src:url(data:font/woff2;base64,${fonts.regular}) format("woff2"); font-display:block; }
  @font-face{ font-family:"Liberation Sans"; font-style:normal; font-weight:700;
    src:url(data:font/woff2;base64,${fonts.bold}) format("woff2"); font-display:block; }
  @font-face{ font-family:"Liberation Sans"; font-style:italic; font-weight:400;
    src:url(data:font/woff2;base64,${fonts.italic}) format("woff2"); font-display:block; }
`;
// Sniff the real type: the file is named .jpg but has historically been a PNG,
// and while browsers tolerate a wrong MIME on data: URIs, Chromium's PDF
// pipeline is stricter about it.
const photoBytes = readFileSync(join(root, "photo.jpg"));
const photoMime = photoBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ? "image/png"
  : "image/jpeg";
const photoDataUri = `data:${photoMime};base64,${photoBytes.toString("base64")}`;

function meta(html, name, file) {
  const re = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i");
  const m = html.match(re);
  if (!m) {
    console.error(`embed: ${file} is missing <meta name="${name}" content="...">`);
    process.exit(1);
  }
  return m[1];
}

function loadTheme(file, id, isDefault) {
  const html = readFileSync(join(root, file), "utf8");
  // Every theme must have exactly one <style> (where the Worker injects
  // @font-face) and a bare <head> / <body> (where it injects the web chrome).
  for (const tag of ["<style>", "<head>", "<body>"]) {
    if (html.split(tag).length !== 2) {
      console.error(`embed: ${file} must contain exactly one literal ${tag}`);
      process.exit(1);
    }
  }
  return {
    id,
    name: meta(html, "theme-name", file),
    description: meta(html, "theme-description", file),
    file,
    isDefault,
    html,
  };
}

const themes = [loadTheme("resume.html", "navy", true)];
const themesDir = join(root, "themes");
if (existsSync(themesDir)) {
  const files = readdirSync(themesDir).filter((f) => f.endsWith(".html")).sort();
  for (const f of files) {
    const id = basename(f, ".html").replace(/^\d+-/, "");
    if (themes.some((t) => t.id === id)) {
      console.error(`embed: duplicate theme id "${id}" (${f})`);
      process.exit(1);
    }
    themes.push(loadTheme(join("themes", f), id, false));
  }
}

const out = JSON.stringify({ fontFaceCss, photoDataUri, themes });
writeFileSync(join(root, "themes.embedded.json"), out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`Wrote themes.embedded.json (${themes.length} theme${themes.length === 1 ? "" : "s"}, ${kb} KB)`);
for (const t of themes) console.log(`  ${t.isDefault ? "*" : " "} ${t.id.padEnd(22)} ${t.name}  (${t.file})`);
