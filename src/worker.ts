import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";
// Generated at build time by scripts/embed.mjs: every theme's raw HTML plus a
// single copy of the base64 fonts and photo, which are spliced into a theme
// right before it is served or rendered (see themeHtml).
import BUNDLE, { type EmbeddedTheme } from "../themes.embedded.json";

const CHATWOOT_BASE_URL = "https://support.aswincloud.com";
// aswincloud.com inbox — see the note by chatWidget below.
const CHATWOOT_WEBSITE_TOKEN = "A2f18JGY7uLahTifqxi74Ncd";

interface Env {
  BROWSER: Fetcher;
  PDF_CACHE: KVNamespace;
}

const PDF_FILENAME = "Aswin_Resume.pdf";
const THEMES_PREFIX = "/themes";

const THEMES: EmbeddedTheme[] = BUNDLE.themes;
const DEFAULT_THEME = THEMES.find((t) => t.isDefault) ?? THEMES[0];
const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

// Brand favicon: gold "A" monogram on a rounded navy tile (matches the default
// theme's #16215a / #c9a86b palette). Inlined as a data-URI in <head> and also
// served at /favicon.ico for clients that request it directly.
const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="14" fill="#16215a"/>` +
  `<text x="32" y="45" font-family="Arial,Helvetica,sans-serif" font-size="40"` +
  ` font-weight="700" text-anchor="middle" fill="#c9a86b">A</text></svg>`;

// URL paths for a theme. The default theme keeps the historical root URLs so
// existing links (and the README) stay valid; every other theme lives under
// /themes/<id>.
function pagePath(t: EmbeddedTheme): string {
  return t.isDefault ? "/" : `${THEMES_PREFIX}/${t.id}`;
}
function pdfPath(t: EmbeddedTheme): string {
  return t.isDefault ? `/${PDF_FILENAME}` : `${THEMES_PREFIX}/${t.id}/${PDF_FILENAME}`;
}

// The self-contained HTML for a theme: @font-face rules injected at the top of
// its <style>, photo inlined as a data URI. Memoised per isolate — the photo is
// ~1.6 MB base64, so this is not free, but it is done once per theme.
const renderable = new Map<string, string>();
function themeHtml(t: EmbeddedTheme): string {
  let html = renderable.get(t.id);
  if (html === undefined) {
    html = t.html
      .replace("<style>", `<style>${BUNDLE.fontFaceCss}`)
      .split('src="photo.jpg"')
      .join(`src="${BUNDLE.photoDataUri}"`);
    renderable.set(t.id, html);
  }
  return html;
}

// Short, stable content hash of a theme's final HTML → cache key. A resume
// edit changes the HTML → new key → transparent re-render.
const hashes = new Map<string, Promise<string>>();
function contentHash(t: EmbeddedTheme): Promise<string> {
  let p = hashes.get(t.id);
  if (!p) {
    p = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(themeHtml(t)))
      .then((digest) =>
        [...new Uint8Array(digest)]
          .slice(0, 8)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
    hashes.set(t.id, p);
  }
  return p;
}

// How long an idle Browser Run session stays alive after we disconnect from
// it, so the next render can reattach instead of launching a fresh browser.
const BROWSER_KEEP_ALIVE_MS = 10 * 60 * 1000;
// Upper bound on how long a request waits for a browser before giving up.
const ACQUIRE_DEADLINE_MS = 15_000;
const ACQUIRE_POLL_MS = 1_500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Reattach to a kept-alive session nobody is using, or return undefined.
async function connectIdle(env: Env): Promise<Browser | undefined> {
  let sessions;
  try {
    sessions = await puppeteer.sessions(env.BROWSER);
  } catch {
    return undefined;
  }
  for (const s of sessions) {
    if (s.connectionId) continue; // another request is using it
    try {
      return await puppeteer.connect(env.BROWSER, s.sessionId);
    } catch {
      // Session may have just expired or been claimed; try the next one.
    }
  }
  return undefined;
}

// Browser Run caps how many *new* browsers an account may start per minute,
// and with twenty-one themes a visitor clicking through the gallery hits that
// cap on the second uncached PDF — the launch fails within half a second. So:
// prefer reattaching to an idle session we kept alive after an earlier render;
// launch only while the account still has launch budget; and otherwise wait,
// because the session a concurrent render is holding becomes idle the moment
// that render finishes, which is usually within a few seconds.
async function acquireBrowser(env: Env): Promise<Browser> {
  const deadline = Date.now() + ACQUIRE_DEADLINE_MS;
  let lastErr: unknown = new Error("no Browser Run session available");
  for (;;) {
    const idle = await connectIdle(env);
    if (idle) return idle;

    const limits = await puppeteer.limits(env.BROWSER).catch(() => undefined);
    if (!limits || limits.allowedBrowserAcquisitions > 0) {
      try {
        return await puppeteer.launch(env.BROWSER, { keep_alive: BROWSER_KEEP_ALIVE_MS });
      } catch (err) {
        lastErr = err;
      }
    } else {
      lastErr = new Error(
        `Browser Run launch budget exhausted; next launch allowed in ${limits.timeUntilNextAllowedBrowserAcquisition}s`,
      );
    }

    if (Date.now() + ACQUIRE_POLL_MS > deadline) throw lastErr;
    await sleep(ACQUIRE_POLL_MS);
  }
}

async function renderPdf(env: Env, t: EmbeddedTheme): Promise<Uint8Array> {
  const browser = await acquireBrowser(env);
  let page: Page | undefined;
  try {
    page = await browser.newPage();
    // networkidle0 lets inline data: URLs — and the Google Fonts @import some
    // themes use — settle before printing.
    await page.setContent(themeHtml(t), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // honor the theme's @page{ size:A4; margin:0 }
    });
    return pdf;
  } finally {
    // Close our tab but keep the browser: disconnect() leaves the session
    // running for keep_alive so the next render can reuse it.
    await page?.close().catch(() => undefined);
    await browser.disconnect().catch(() => undefined);
  }
}

async function getPdf(
  env: Env,
  ctx: ExecutionContext,
  t: EmbeddedTheme,
): Promise<{ pdf: Uint8Array; hash: string }> {
  const hash = await contentHash(t);
  const key = `pdf:${hash}`;
  const cached = await env.PDF_CACHE.get(key, "arrayBuffer");
  if (cached) return { pdf: new Uint8Array(cached), hash };

  const pdf = await renderPdf(env, t);
  // Persist without blocking the response.
  ctx.waitUntil(env.PDF_CACHE.put(key, pdf));
  return { pdf, hash };
}

const REVALIDATE = "public, max-age=60, must-revalidate";

function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { etag, "cache-control": REVALIDATE } });
}

// Resolve a request path to (theme, kind). Returns null for anything that is
// not a theme route.
function route(path: string): { theme: EmbeddedTheme; kind: "page" | "pdf" } | null {
  if (path === "/" || path === "/index.html") return { theme: DEFAULT_THEME, kind: "page" };
  if (path === `/${PDF_FILENAME}`) return { theme: DEFAULT_THEME, kind: "pdf" };

  if (!path.startsWith(`${THEMES_PREFIX}/`)) return null;
  const rest = path.slice(THEMES_PREFIX.length + 1).replace(/\/$/, "");
  const [id, file, ...extra] = rest.split("/");
  if (extra.length) return null;
  const theme = THEME_BY_ID.get(id);
  if (!theme) return null;
  if (file === undefined || file === "") return { theme, kind: "page" };
  if (file === PDF_FILENAME) return { theme, kind: "pdf" };
  return null;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Favicon (also referenced inline in the page <head>). Served as SVG.
    if (path === "/favicon.ico" || path === "/favicon.svg") {
      return new Response(FAVICON_SVG, {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    // Index of every theme, with links to the page and PDF of each.
    if (path === THEMES_PREFIX || path === `${THEMES_PREFIX}/`) {
      return new Response(galleryPage(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": REVALIDATE },
      });
    }

    const r = route(path);
    if (!r) return new Response("Not found", { status: 404 });

    // The resume itself, served as a real HTML page (same source the PDF is
    // rendered from → identical look, but selectable text + SEO + responsive).
    if (r.kind === "page") {
      const hash = await contentHash(r.theme);
      // The web chrome (top bar, theme list) is part of the page, so it must be
      // part of the tag too — adding a theme changes every page's picker.
      const etag = `"web-${hash}-${THEMES.length}"`;
      if (request.headers.get("if-none-match") === etag) return notModified(etag);
      return new Response(webPage(r.theme), {
        headers: { "content-type": "text/html; charset=utf-8", etag, "cache-control": REVALIDATE },
      });
    }

    // The PDF: view inline (default) or force download (?download).
    let pdf: Uint8Array;
    let hash: string;
    try {
      ({ pdf, hash } = await getPdf(env, ctx, r.theme));
    } catch (err) {
      // Include the account's Browser Run limits so a refused launch is
      // diagnosable from the log alone.
      const limits = await puppeteer.limits(env.BROWSER).catch(() => undefined);
      console.log(JSON.stringify({ msg: "pdf render failed", theme: r.theme.id, err: String(err), limits }));
      return new Response("Failed to render PDF.", { status: 502 });
    }

    // ETag is the content hash: when the theme's HTML changes the hash changes,
    // so caches revalidate and pick up the new render immediately instead of
    // serving a stale copy for the full max-age.
    const etag = `"${hash}"`;
    if (request.headers.get("if-none-match") === etag) return notModified(etag);

    const disposition = url.searchParams.has("download")
      ? `attachment; filename="${PDF_FILENAME}"`
      : `inline; filename="${PDF_FILENAME}"`;
    return new Response(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": disposition,
        etag,
        // Short TTL + revalidation: fast repeat loads, but an edit is visible
        // within ~a minute rather than pinned for an hour.
        "cache-control": REVALIDATE,
      },
    });
  },
} satisfies ExportedHandler<Env>;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Shared look of the fixed top bar. Neutral dark slate rather than the default
// theme's navy so it sits acceptably over all twenty-one palettes.
const TOPBAR_CSS = `
    #topbar { position:fixed; top:0; left:0; right:0; z-index:100;
      display:flex; align-items:center; justify-content:space-between; gap:12px;
      background:#151a26; color:#fff; padding:0 16px; height:52px;
      font-family:Arial,Helvetica,sans-serif; font-size:14px;
      box-shadow:0 2px 10px rgba(0,0,0,.35); box-sizing:border-box; }
    #topbar a { color:inherit; text-decoration:none; }
    #topbar .who { font-weight:700; letter-spacing:.5px; white-space:nowrap; }
    #topbar .who span { color:#c9a86b; margin-left:8px; font-weight:400;
      letter-spacing:2px; font-size:11px; text-transform:uppercase; }
    #topbar .pick { display:flex; align-items:center; gap:8px; min-width:0; flex:1;
      justify-content:center; }
    #topbar .pick label { color:#aab2c5; font-size:12px; text-transform:uppercase;
      letter-spacing:1.5px; white-space:nowrap; }
    #topbar select { background:#232a3a; color:#fff; border:1px solid #3a4358;
      border-radius:7px; padding:7px 10px; font-size:14px; max-width:260px;
      cursor:pointer; }
    #topbar .arrow { color:#aab2c5; font-size:18px; line-height:1; padding:6px 8px;
      border-radius:6px; }
    #topbar .arrow:hover { background:#232a3a; color:#fff; }
    #topbar #dl { background:#c9a86b; color:#151a26; font-weight:700;
      padding:9px 14px; border-radius:7px; white-space:nowrap; }
    #topbar #dl:hover { filter:brightness(1.05); }
    @media (max-width:720px) {
      #topbar .who span, #topbar .pick label, #topbar .arrow { display:none; }
      #topbar select { max-width:160px; }
      #topbar #dl { padding:9px 10px; }
    }`;

function topBar(current: EmbeddedTheme): string {
  const options = THEMES.map(
    (t) =>
      `<option value="${escapeHtml(pagePath(t))}"${t.id === current.id ? " selected" : ""}>` +
      `${escapeHtml(t.name)}</option>`,
  ).join("");
  const i = THEMES.indexOf(current);
  const prev = THEMES[(i - 1 + THEMES.length) % THEMES.length];
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    `<div id="topbar">` +
    `<a class="who" href="${THEMES_PREFIX}" title="All themes">Aswin<span>Senior Software Engineer</span></a>` +
    `<div class="pick">` +
    `<a class="arrow" href="${escapeHtml(pagePath(prev))}" title="Previous theme: ${escapeHtml(prev.name)}" aria-label="Previous theme">&#8249;</a>` +
    `<label for="theme">Theme</label>` +
    `<select id="theme" aria-label="Theme" onchange="location.href=this.value">${options}</select>` +
    `<a class="arrow" href="${escapeHtml(pagePath(next))}" title="Next theme: ${escapeHtml(next.name)}" aria-label="Next theme">&#8250;</a>` +
    `</div>` +
    `<a id="dl" href="${escapeHtml(pdfPath(current))}?download">&#8595; PDF</a>` +
    `</div>`
  );
}

// Turn a print-oriented theme into a web page: add page metadata, the fixed
// top bar with the theme picker, and screen-only styling. Everything injected
// is scoped to @media screen, so it can never affect the PDF (which is
// rendered from the untouched theme HTML with print emulation).
function webPage(theme: EmbeddedTheme): string {
  const title = theme.isDefault
    ? "Aswin — Senior Software Engineer · Resume"
    : `Aswin — Senior Software Engineer · Resume (${theme.name})`;

  // The default theme's phone layout reflows its fixed-A4 two-column grid to
  // one readable column. Those rules are tied to its class names and the
  // gradient it paints on <body>, so they apply to that theme only.
  const defaultPhoneCss = `
  @media screen and (max-width:640px) {
    html { background:#fff; }
    body { max-width:none; box-shadow:none; background:#16215a !important; }
    .page { display:block !important; min-height:0 !important; }
    .side { width:100% !important; background:#16215a !important; }
    .main { width:100% !important; background:#fff !important; }
    .name { font-size:30px !important; }
  }`;

  // Every other theme is a fixed 210mm sheet; on narrow screens scale the whole
  // sheet down to fit rather than let it overflow sideways. The factor lives in
  // a CSS variable so the fixed chrome (top bar, chat bubble), which sits inside
  // <body> and would shrink with it, can zoom back out by the inverse.
  const fitScript = `<script>(function(){var W=794;function fit(){var s=Math.min(1,innerWidth/W);` +
    `document.documentElement.style.setProperty("--fit",String(s));}addEventListener("resize",fit);fit();})();</script>`;
  const fitCss = `
  @media screen {
    body { zoom:var(--fit,1); }
    #topbar, .woot-widget-holder, .woot--bubble-holder { zoom:calc(1 / var(--fit,1)); }
  }`;

  const head = `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Aswin — Senior Software Engineer working on next-generation AI accelerator hardware: compute kernels, profiling, and model tracing.">
  <meta property="og:title" content="Aswin — Senior Software Engineer">
  <meta property="og:description" content="Resume — senior AI-accelerator software engineer.">
  <meta property="og:type" content="profile">
  <style>
  @media screen {
    html { background:#e9ecf3; width:auto !important; }
    ${TOPBAR_CSS}
    /* Push the whole page down so the fixed bar never overlaps the sheet. */
    html { padding-top:52px; }
    /* Center the A4 sheet under the bar and give it depth on desktop. */
    body { margin:0 auto !important; max-width:210mm; box-shadow:0 6px 30px rgba(22,33,90,.18); }
  }${theme.isDefault ? defaultPhoneCss : fitCss}
  /* Belt-and-suspenders: never show the bar when printing from the browser.
     Same for the support widget — it is a fixed-position overlay, so without
     this it would print on top of the resume. (The downloadable PDF is
     rendered from the untouched theme HTML and never sees any of this.) */
  @media print {
    #topbar, .woot-widget-holder, .woot--bubble-holder { display:none !important; }
  }
  </style>`;

  // Chatwoot support widget. It points at the aswincloud.com inbox on purpose:
  // that inbox's knowledge is already "facts about Aswin" — background, skills,
  // employer, contact — which is exactly what someone reading a resume asks.
  // A separate inbox would duplicate that and add nothing the source-site
  // label does not already give. Deferred to `defer` so it never blocks the
  // resume painting.
  const chatWidget =
    `<script>window.chatwootSettings={position:"right",type:"standard",` +
    `launcherTitle:"Ask about Aswin"};</script>` +
    `<script defer src="${CHATWOOT_BASE_URL}/packs/js/sdk.js" onload=` +
    `'window.chatwootSDK.run({websiteToken:"${CHATWOOT_WEBSITE_TOKEN}",baseUrl:"${CHATWOOT_BASE_URL}"})'></script>`;

  // Left/right arrow keys step through themes.
  const i = THEMES.indexOf(theme);
  const prev = pagePath(THEMES[(i - 1 + THEMES.length) % THEMES.length]);
  const next = pagePath(THEMES[(i + 1) % THEMES.length]);
  const keys =
    `<script>addEventListener("keydown",function(e){if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;` +
    `if(e.key==="ArrowLeft")location.href=${JSON.stringify(prev)};else if(e.key==="ArrowRight")location.href=${JSON.stringify(next)};});</script>`;

  // Order matters: do the <body> injection on the RAW theme first, so the
  // string can only match the real body tag — not a literal "<body>" that
  // appears inside a CSS comment in the head we inject below. (embed.mjs
  // guarantees each theme has exactly one literal <head>, <body>, <style>.)
  let out = themeHtml(theme).replace(
    "<body>",
    `<body>${topBar(theme)}${chatWidget}${keys}${theme.isDefault ? "" : fitScript}`,
  );
  // Then inject metadata + styles right after <head>.
  out = out.replace("<head>", `<head>${head}`);
  return out;
}

// /themes — a plain index of every theme with links to its page and PDF.
function galleryPage(): string {
  const cards = THEMES.map(
    (t) =>
      `<li><a class="card" href="${escapeHtml(pagePath(t))}">` +
      `<div class="n">${escapeHtml(t.name)}${t.isDefault ? ' <span class="tag">default</span>' : ""}</div>` +
      `<div class="d">${escapeHtml(t.description)}</div></a>` +
      `<a class="pdf" href="${escapeHtml(pdfPath(t))}">PDF</a></li>`,
  ).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}">
  <title>Aswin — Resume themes</title>
  <meta name="robots" content="noindex">
  <style>
    body { margin:0; background:#e9ecf3; color:#1c2333; font-family:Arial,Helvetica,sans-serif; }
    header { background:#151a26; color:#fff; padding:14px 20px; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
    header h1 { margin:0; font-size:18px; }
    header a { color:#c9a86b; text-decoration:none; font-size:14px; }
    main { max-width:960px; margin:0 auto; padding:24px 16px 48px; }
    p.lead { color:#5b6172; margin:0 0 20px; }
    ul { list-style:none; margin:0; padding:0; display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
    li { display:flex; background:#fff; border-radius:10px; box-shadow:0 2px 10px rgba(22,33,90,.08); overflow:hidden; }
    .card { flex:1; padding:14px 16px; color:inherit; text-decoration:none; }
    .card:hover { background:#f6f7fb; }
    .n { font-weight:700; font-size:15px; }
    .tag { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#fff; background:#c9a86b; border-radius:4px; padding:2px 6px; vertical-align:middle; margin-left:6px; }
    .d { color:#5b6172; font-size:13px; line-height:1.45; margin-top:4px; }
    .pdf { display:flex; align-items:center; padding:0 14px; color:#16215a; font-weight:700; text-decoration:none; border-left:1px solid #e2e5ec; font-size:13px; }
    .pdf:hover { background:#f6f7fb; }
  </style></head><body>
  <header><h1>Aswin — Resume themes</h1><a href="/">← Back to resume</a></header>
  <main><p class="lead">${THEMES.length} layouts of the same resume. Pick one to view it; every theme has its own PDF.</p>
  <ul>${cards}</ul></main></body></html>`;
}
