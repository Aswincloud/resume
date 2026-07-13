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

    // The resume itself, served as a real HTML page (same source the PDF is
    // rendered from → identical look, but selectable text + SEO + responsive).
    if (path === "/" || path === "/index.html") {
      const hash = await contentHash(RESUME_HTML);
      const etag = `"web-${hash}"`;
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { etag, "cache-control": "public, max-age=60, must-revalidate" },
        });
      }
      return new Response(webPage(RESUME_HTML), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          etag,
          "cache-control": "public, max-age=60, must-revalidate",
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

// Turn the print-oriented resume.html into a web page: add page metadata, a
// floating Download-PDF button, and screen-only responsive styling. Everything
// injected is scoped to @media screen, so it can never affect the PDF (which
// is rendered from the untouched RESUME_HTML with print emulation).
function webPage(resumeHtml: string): string {
  const head = `
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aswin — Software Engineer · Resume</title>
  <meta name="description" content="Aswin — Software Engineer working on next-generation AI accelerator hardware: compute kernels, profiling, and model tracing.">
  <meta property="og:title" content="Aswin — Software Engineer">
  <meta property="og:description" content="Resume — AI-accelerator software engineer.">
  <meta property="og:type" content="profile">
  <style>
  @media screen {
    html { background:#e9ecf3; }
    /* Center the A4 sheet and give it depth on desktop. */
    body { margin:0 auto; max-width:210mm; box-shadow:0 6px 30px rgba(22,33,90,.18); }
    /* Floating download button — fixed so it stays reachable while scrolling. */
    #dl { position:fixed; right:16px; bottom:16px; z-index:50;
      background:#c9a86b; color:#16215a; text-decoration:none; font-weight:700;
      font-family:Arial,Helvetica,sans-serif; font-size:14px;
      padding:11px 18px; border-radius:8px; box-shadow:0 3px 12px rgba(0,0,0,.25); }
    #dl:hover { filter:brightness(1.05); }
  }
  /* Phones: reflow the fixed-A4 two-column grid to one readable column.
     The navy sidebar is a linear-gradient painted on <body> at the 34% split,
     not a real element background — so when we stack the columns we must kill
     that gradient and give each column its own solid background, or text lands
     on the wrong colour. */
  @media screen and (max-width:640px) {
    html { background:#fff; }
    body { max-width:none; box-shadow:none; background:#16215a !important; }
    .page { display:block !important; min-height:0 !important; }
    .side { width:100% !important; background:#16215a !important; }
    .main { width:100% !important; background:#fff !important; }
    .name { font-size:30px !important; }
    #dl { left:16px; right:16px; text-align:center; }
  }
  /* Belt-and-suspenders: never show the button when printing from the browser. */
  @media print { #dl { display:none !important; } }
  </style>`;

  const dlButton = `<a id="dl" href="/${PDF_FILENAME}?download">↓ Download PDF</a>`;

  let out = resumeHtml;
  // Inject metadata + styles right after <head> (resume.html has a bare <head>).
  out = out.replace(/<head>/i, `<head>${head}`);
  // Drop the floating button just inside <body>.
  out = out.replace(/<body>/i, `<body>${dlButton}`);
  return out;
}
