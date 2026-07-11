//? intent: Marketing — take your product to market. The AI marketer role turns a short product
//? brief into marketing copy, a go-to-market strategy, email sequences, ad sets, a social calendar,
//? naming, thumbnails and video scripts — each live-previewed. Its own page (user-chosen split) that
//? reuses the shared Studio surface with a marketing focus (marketer kinds only; the designer kinds
//? live on /studio).

import { StudioSurface } from '../studio/page';

export const template = 'workspaces';

export default function Marketing() {
  return <StudioSurface variant="marketing" />;
}
