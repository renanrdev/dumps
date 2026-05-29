// handlers/health.ts — GET /healthz

import { securityHeaders } from "./shared.js";

export function handleHealth(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: {
      ...securityHeaders(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
