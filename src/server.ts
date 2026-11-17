import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { clientKey, hit } from "./lib/rate-limit";
import { setupResponse } from "./lib/setup.server"; // loads saved settings into process.env first

// Optional visitor-tracker script added to every page (e.g. a dashboard's t.js), only when VISITOR_TRACKER_URL is set.
async function withTracker(response: Response): Promise<Response> {
  const src = process.env["VISITOR_TRACKER_URL"];
  if (!src || !/^https?:\/\/[^"<>\s]+$/.test(src) || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html.replace("</body>", `<script src="${src}" async></script></body>`), { status: response.status, statusText: response.statusText, headers });
}

// About 10 requests a second per client sustained over a minute is far above normal use and stops bulk copying.
const REQUESTS_PER_MINUTE = 600;
const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow", // a private tool: keep every page out of search engines
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
function withHeaders(response: Response): Response {
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
    return response;
  } catch {
    // Some responses have immutable headers; copy them into a new one.
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    if (!hit(`req:${clientKey(request)}`, REQUESTS_PER_MINUTE, 60_000)) {
      return withHeaders(new Response("Too many requests. Please wait a minute.", { status: 429, headers: { "retry-after": "60", "content-type": "text/plain" } }));
    }
    try {
      const setup = await setupResponse(request);
      if (setup) return withHeaders(setup);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withHeaders(await withTracker(await normalizeCatastrophicSsrResponse(response)));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
