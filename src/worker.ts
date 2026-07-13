import puppeteer from "@cloudflare/puppeteer";
// Bundled at build time by scripts/embed.mjs — self-contained HTML with inline
// base64 WOFF2 fonts and photo, so Browser Run renders it identically to local.
import RESUME_HTML from "../resume.embedded.html";

interface Env {
  BROWSER: Fetcher;
  PDF_CACHE: KVNamespace;
}

const PDF_FILENAME = "Aswin_Resume.pdf";

// Short, stable content hash of the bundled HTML → cache key. A resume edit
// changes RESUME_HTML → new key → transparent re-render.
async function contentHash(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function renderPdf(env: Env): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    // networkidle0 lets inline data: URLs settle; there are no external fetches.
    await page.setContent(RESUME_HTML, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // honor the resume's @page{ size:A4; margin:0 }
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

async function getPdf(
  env: Env,
  ctx: ExecutionContext,
): Promise<{ pdf: Uint8Array; hash: string }> {
  const hash = await contentHash(RESUME_HTML);
  const key = `pdf:${hash}`;
  const cached = await env.PDF_CACHE.get(key, "arrayBuffer");
  if (cached) return { pdf: new Uint8Array(cached), hash };

  const pdf = await renderPdf(env);
  // Persist without blocking the response.
  ctx.waitUntil(env.PDF_CACHE.put(key, pdf));
  return { pdf, hash };
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Inline viewer.
    if (path === "/" || path === "/index.html") {
      return new Response(VIEWER_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    // The PDF: view inline (default) or force download (?download).
    if (path === `/${PDF_FILENAME}`) {
      let pdf: Uint8Array;
      let hash: string;
      try {
        ({ pdf, hash } = await getPdf(env, ctx));
      } catch (err) {
        console.log(JSON.stringify({ msg: "pdf render failed", err: String(err) }));
        return new Response("Failed to render PDF.", { status: 502 });
      }

      // ETag is the content hash: when resume.html changes the hash changes,
      // so caches revalidate and pick up the new render immediately instead of
      // serving a stale copy for the full max-age.
      const etag = `"${hash}"`;
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { etag, "cache-control": "public, max-age=60, must-revalidate" },
        });
      }

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
          "cache-control": "public, max-age=60, must-revalidate",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// Minimal viewer that embeds the PDF and offers a download button.
const VIEWER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aswin — Resume</title>
<meta name="description" content="Aswin — Software Engineer. Resume.">
<style>
  :root{--navy:#16215a;--gold:#c9a86b}
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{font-family:Arial,Helvetica,sans-serif;background:#eef0f4;color:var(--navy);display:flex;flex-direction:column;min-height:100vh}
  header{background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;flex-wrap:wrap}
  header .who{font-size:18px;font-weight:bold;letter-spacing:.5px}
  header .who span{color:var(--gold);margin-left:8px;letter-spacing:2px;font-size:13px;text-transform:uppercase}
  .dl{background:var(--gold);color:var(--navy);text-decoration:none;font-weight:bold;font-size:14px;padding:9px 16px;border-radius:6px;white-space:nowrap}
  main{flex:1;display:flex}object,iframe{flex:1;width:100%;border:0}
  .fallback{padding:40px;text-align:center}.fallback a{color:var(--navy)}
</style></head>
<body>
  <header>
    <div class="who">Aswin<span>Software Engineer</span></div>
    <a class="dl" href="/${PDF_FILENAME}?download">Download PDF</a>
  </header>
  <main>
    <object data="/${PDF_FILENAME}" type="application/pdf">
      <div class="fallback"><p>Your browser can't display the PDF inline.</p>
      <p><a href="/${PDF_FILENAME}?download">Download the resume PDF</a></p></div>
    </object>
  </main>
</body></html>`;
