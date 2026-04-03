# AgentRouter Proxy

A lightweight Vercel Edge Function that proxies API requests to `agentrouter.org`,
bypassing WAF restrictions that block requests from certain server IP ranges.

## Deploy

### Option 1: Vercel Dashboard (easiest)

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import this directory (or push it to a Git repo first)
3. Deploy — no build settings needed
4. Copy the deployment URL (e.g. `https://agentrouter-proxy-xxx.vercel.app`)

### Option 2: Vercel CLI

```bash
cd proxy/agentrouter
npx vercel --prod
```

Copy the deployment URL from the output.

## Configure

Set the proxy URL as an environment variable on the API server:

```bash
AGENTROUTER_PROXY_URL=https://your-deployment-url.vercel.app
```

Then rebuild and restart the API server:

```bash
npm run -w @workspace/api-server build
# restart the server process
```

## How it works

The edge function receives all incoming requests, rewrites the target host
to `agentrouter.org`, and forwards the request with the original method,
headers (including `Authorization: Bearer ...`), and body. Streaming
responses (SSE) are supported since the edge runtime passes through
`ReadableStream` bodies.
