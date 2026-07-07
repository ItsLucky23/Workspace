//? Client media upload (FREEDOM_PROGRAM K1). POSTs a File's raw bytes to the backend `/media/upload` route
//? (authed via the session cookie; origin-exempt) and returns the resulting `/media/<file>` url + kind. Used
//? by the reference-image picker (bring your own reference) + the "import your own asset" action.

import { tryCatch } from '@luckystack/core/client';

import { backendUrl } from '../../../config';

//? MIME → extension the upload route accepts (extension is the server's source of truth). Falls back to the
//? filename extension when the browser gives no/odd MIME.
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov']);

export interface UploadedMedia { url: string; kind: string }

export async function uploadMedia(file: File, workspaceId: string): Promise<UploadedMedia | null> {
  const ext = MIME_EXT[file.type] ?? (file.name.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED.has(ext)) return null;
  const [err, res] = await tryCatch(() => fetch(`${backendUrl}/media/upload?ws=${encodeURIComponent(workspaceId)}&ext=${ext}`, {
    method: 'POST', body: file, credentials: 'include',
    ...(file.type ? { headers: { 'Content-Type': file.type } } : {}),
  }));
  if (err || !res?.ok) return null;
  const [parseErr, body] = await tryCatch(() => res.json() as Promise<{ url?: string; kind?: string }>);
  if (parseErr || typeof body?.url !== 'string' || typeof body.kind !== 'string') return null;
  return { url: body.url, kind: body.kind };
}
