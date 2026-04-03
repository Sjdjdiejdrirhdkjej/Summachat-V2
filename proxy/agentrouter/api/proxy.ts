export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const proxyPath = url.searchParams.get("proxyPath") || "";
  const targetUrl = new URL(
    `/${proxyPath}`,
    "https://agentrouter.org"
  );

  const authorization = request.headers.get("authorization") || "";
  const contentType = request.headers.get("content-type") || "";
  const anthropicVersion = request.headers.get("anthropic-version") || "";
  const xApiKey = request.headers.get("x-api-key") || "";

  const headers = new Headers({
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/event-stream, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
  });

  if (authorization) headers.set("Authorization", authorization);
  if (contentType) headers.set("Content-Type", contentType);
  if (anthropicVersion) headers.set("anthropic-version", anthropicVersion);
  if (xApiKey) headers.set("x-api-key", xApiKey);

  const init: RequestInit & { duplex?: string } = {
    method: request.method,
    headers,
    redirect: "follow",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl.toString(), init);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown proxy error";
    return new Response(
      JSON.stringify({ error: "bad_gateway", message }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
