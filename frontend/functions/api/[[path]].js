const FORWARD = ["authorization", "content-type", "range", "if-range"];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const error = (message, status) => Response.json({ error: message }, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  if (!env.HB_API_ORIGIN || !env.HB_PROXY_SECRET) return error("The conversion service is unavailable.", 503);
  if (!/^(GET|POST|PUT|HEAD)$/.test(request.method)) return error("Method not allowed.", 405);
  if ((request.method === "POST" || request.method === "PUT") &&
      request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
    return error("Cross-origin uploads are blocked.", 403);
  }
  try {
    const origin = new URL(env.HB_API_ORIGIN);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
      return error("The conversion origin is misconfigured.", 503);
    }
    const upstream = new URL(origin);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const headers = new Headers();
    for (const key of FORWARD) {
      const value = request.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set("X-HB-Origin", env.HB_PROXY_SECRET);
    headers.set("X-HB-Client", request.headers.get("CF-Connecting-IP") || "unknown");
    return await fetch(upstream, {
      method: request.method, headers, body: request.body, redirect: "manual",
    });
  } catch {
    return error("The conversion service could not be reached.", 502);
  }
}
