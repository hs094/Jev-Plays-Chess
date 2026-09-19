const OPEN_CODE_ENDPOINT = "https://opencode.ai/zen/v1/systemone";

interface Env {
  ASSETS: Fetcher;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/jev") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      if (request.method !== "POST") {
        return withCors(new Response("Method not allowed", { status: 405 }), request);
      }

      const authorization = request.headers.get("Authorization");
      if (!authorization) {
        return withCors(new Response("Missing Jev API key", { status: 401 }), request);
      }

      const upstream = await fetch(OPEN_CODE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: request.body,
      });
      return withCors(upstream, request);
    }

    return env.ASSETS.fetch(request);
  },
};
