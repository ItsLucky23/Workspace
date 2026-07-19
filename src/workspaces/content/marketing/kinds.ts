//? Marketing — kind metadata for the KISS surface. MARKETER_KINDS is the generate grid (marketer
//? role only — the designer kinds live on /studio); KIND_ICONS covers ALL kinds because artifacts
//? are filtered by briefId only, so designer artifacts (landing/brand/component) generated on
//? /studio also render here and need their icon.

import type { IconName } from '../../_components/Icon';
import type { StudioArtifactKind } from '../../_data/types';

export const MARKETER_KINDS: { kind: StudioArtifactKind; icon: IconName }[] = [
  { kind: 'copy', icon: 'pen-nib' },
  { kind: 'strategy', icon: 'chess-knight' },
  { kind: 'email', icon: 'envelope' },
  { kind: 'ads', icon: 'bullhorn' },
  { kind: 'social', icon: 'calendar-days' },
  { kind: 'names', icon: 'signature' },
  { kind: 'thumbnail', icon: 'image' },
  { kind: 'videoScript', icon: 'film' },
];

export const KIND_ICONS: Record<StudioArtifactKind, IconName> = {
  landing: 'window-maximize',
  component: 'cube',
  brand: 'palette',
  copy: 'pen-nib',
  strategy: 'chess-knight',
  email: 'envelope',
  ads: 'bullhorn',
  social: 'calendar-days',
  names: 'signature',
  thumbnail: 'image',
  videoScript: 'film',
};
