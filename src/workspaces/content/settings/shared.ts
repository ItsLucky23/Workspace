//? content/settings — shared constants + helpers for the settings tab files (BrandStylesTab / ChannelsTab /
//? AdminTab / portalForms). Not routed (only page.tsx routes); kept tiny so page.tsx stays the composition root.

import { backendUrl } from '../../../../config';

//? Prefix a backend-relative /media URL for the client origin (uploads land as /media/…); pass external URLs through.
export const mediaSrc = (url: string): string => (url.startsWith('/media/') ? `${backendUrl}${url}` : url);

//? One input recipe for the whole settings surface — text-base under md (no iOS focus-zoom), text-sm from md up.
export const fieldCls = 'rounded-lg border border-container2-border bg-container2 px-3 py-2 text-base md:text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring';

//? The five features a style can target (matches the server's style validation).
export const STYLE_FEATURES = ['script', 'image-gen', 'reference-image', 'video-gen', 'tts'];

//? Publish platforms that have a real connect + upload flow (M5). Instagram/LinkedIn are future-ready.
export const PUBLISH_PLATFORMS: { id: string; nameKey: string }[] = [
  { id: 'youtube', nameKey: 'workspaces.content.platformYoutube' },
  { id: 'tiktok', nameKey: 'workspaces.content.platformTiktok' },
];
