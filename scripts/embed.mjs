#!/usr/bin/env node
// Produce a fully self-contained resume: inline @font-face (base64 WOFF2),
// inline photo (base64), no external references. Output: resume.embedded.html.
//
// This single artifact is what we (a) render locally to verify layout and
// (b) hand to Cloudflare Browser Run at runtime — so local and prod render
// byte-for-byte the same fonts, independent of whatever fonts the render
// container happens to have installed.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (p) => readFileSync(join(root, p)).toString("base64");

const fonts = {
  regular: b64("fonts/LiberationSans-Regular.woff2"),
  bold: b64("fonts/LiberationSans-Bold.woff2"),
  italic: b64("fonts/LiberationSans-Italic.woff2"),
};
const photo = b64("photo.jpg");

const fontFaceCss = `
  @font-face{ font-family:"Liberation Sans"; font-style:normal; font-weight:400;
    src:url(data:font/woff2;base64,${fonts.regular}) format("woff2"); font-display:block; }
  @font-face{ font-family:"Liberation Sans"; font-style:normal; font-weight:700;
    src:url(data:font/woff2;base64,${fonts.bold}) format("woff2"); font-display:block; }
  @font-face{ font-family:"Liberation Sans"; font-style:italic; font-weight:400;
    src:url(data:font/woff2;base64,${fonts.italic}) format("woff2"); font-display:block; }
`;

let html = readFileSync(join(root, "resume.html"), "utf8");

// 1) inject @font-face immediately after the opening <style> so it wins early.
html = html.replace(/<style>/, `<style>${fontFaceCss}`);

// 2) inline the photo.
html = html.replace(/src="photo\.jpg"/, `src="data:image/jpeg;base64,${photo}"`);

if (html.includes("photo.jpg") || html.includes("</style>") === false) {
  console.error("embed: expected substitutions not all applied");
  process.exit(1);
}

writeFileSync(join(root, "resume.embedded.html"), html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`Wrote resume.embedded.html (${kb} KB, self-contained)`);
