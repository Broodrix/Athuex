# Cloudflare workers

## v1.3.3 / proxy v2.0.0 / MCP v2.0.0

### nvidia-cors-proxy
- File: `worker.js` version **2.0.0**
- Streaming-safe (does not strip content-encoding)
- Hosts: NVIDIA, GitHub, MCP, search (DuckDuckGo, Wikipedia, Serper, Brave, Bing, Tavily), workers.dev, supabase

### athuex-mcp-server
- File: `mcp-server.js` version **2.0.0**
- Dual-era: modern `2026-07-28` + legacy `2025-11-25` / `2025-06-18` / `2025-03-26`
- Tools: echo, get_time, remember, recall, list_keys, nvidia_api
- Bindings: `MCP_MEMORY` (KV), `PROXY_URL` (must end with `?url=`), optional `PROXY_KEY`, `NVIDIA_API_KEY`

Redeploy both workers after copying these files.
