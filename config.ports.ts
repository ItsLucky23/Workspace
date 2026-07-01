//? SINGLE SOURCE OF TRUTH for the project's dev network config — the frontend
//? (dev) + backend ports, and (optionally) a remote backend to develop against.
//?
//? PURE DATA — no imports, no side-effects — so `vite.config.ts` can read this
//? WITHOUT importing `config.ts` (which registers projectConfig and pulls
//? server-only `@luckystack/core`). `config.ts` re-exports `ports` and `server.ts`
//? passes `backend` to the server, so there is exactly ONE place to change a port.
export const ports: {
  /** Vite dev-server port (dev only). */
  frontend: number;
  /** Single-instance backend listen port. Multi-instance setups define per-service
   *  ports in `deploy.config.ts` bindings instead; a positional argv port —
   *  `npm run server -- <preset> <port>` — still overrides both. */
  backend: number;
  /** OPTIONAL: develop the local frontend against a REMOTE backend (a deployed /
   *  staging API) instead of the local one. Set it to that backend's origin, e.g.
   *  'https://staging-api.example.com'. The Vite dev proxy then forwards /api,
   *  /sync, /auth, /socket.io, … there (with changeOrigin), so the BROWSER stays
   *  same-origin on localhost:frontend — cookies remain first-party and no CORS is
   *  needed. Leave undefined to use the local backend. (For full remote AUTH also
   *  point PUBLIC_URL / oauthCallbackBase at the remote; the proxy alone already
   *  covers same-origin session cookies + sockets.) */
  devBackendUrl?: string;
} = {
  frontend: 5173,
  backend: 80,
  // devBackendUrl: 'https://staging-api.example.com',
};
