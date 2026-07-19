import { backendUrl } from '../../../../config';

//? A downloadable/openable href for an asset: `/media/<file>` is served by the backend (prefix its origin),
//? a hosted `http(s)` url is used as-is, and a `stub://` (dummy-mode) url is not openable → null.
//? Own file (not AssetCard.tsx) so the component file only exports components (react-refresh rule) while
//? page.tsx can still share the helper.
export function assetHref(url: string): string | null {
  if (url.startsWith('/media/')) return `${backendUrl}${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return null;
}
