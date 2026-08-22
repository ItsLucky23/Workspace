//? Studio + Marketing — the ONE kind catalogue (F-005/F-020). The two pages used to carry their own
//? icon tables and had already drifted (copy = file-lines vs pen-nib, ads = bolt vs bullhorn …). The
//? recorded split is honoured here: DESIGNER_KINDS is /studio's generate grid, MARKETER_KINDS is
//? /marketing's; KIND_ICONS covers ALL kinds because artifacts are filtered by brief, so a kind generated
//? on the other page still renders (with the same icon) on this one.

import type { IconName } from '../../_components/Icon';
import type { StudioArtifactKind } from '../../_data/types';

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

export const DESIGNER_KINDS: readonly StudioArtifactKind[] = ['landing', 'component', 'brand'];
export const MARKETER_KINDS: readonly StudioArtifactKind[] = ['copy', 'strategy', 'email', 'ads', 'social', 'names', 'thumbnail', 'videoScript'];
