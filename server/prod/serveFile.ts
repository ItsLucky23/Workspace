//? Production static-file and SPA fallback handlers for the Vite build in dist/.

import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const distRoot = resolve(process.cwd(), 'dist');
const indexFile = resolve(distRoot, 'index.html');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

const sendFile = (
  file: string,
  response: ServerResponse,
  options: { cache: boolean; headOnly?: boolean },
): void => {
  response.writeHead(200, {
    'Cache-Control': options.cache ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
  });

  if (options.headOnly) {
    response.end();
    return;
  }

  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
};

export const serveFile = (request: IncomingMessage, response: ServerResponse): void => {
  const rawPath = (request.url ?? '/').split('?', 1)[0] ?? '/';
  const requestedFile = resolve(distRoot, `.${rawPath}`);
  const insideDist = requestedFile === distRoot || requestedFile.startsWith(`${distRoot}${sep}`);
  const assetFile = insideDist && isFile(requestedFile) ? requestedFile : null;
  const spaFallbackAllowed = extname(rawPath) === '';
  const file = assetFile ?? (spaFallbackAllowed ? indexFile : '');

  if (file.length === 0 || !isFile(file)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  sendFile(file, response, {
    cache: assetFile !== null && rawPath.startsWith('/assets/'),
    headOnly: request.method === 'HEAD',
  });
};

export const serveFavicon = (response: ServerResponse): void => {
  const favicon = resolve(distRoot, 'favicon.ico');
  if (!isFile(favicon)) {
    response.writeHead(204);
    response.end();
    return;
  }
  sendFile(favicon, response, { cache: true });
};
