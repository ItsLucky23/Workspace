//? Workspaces — placeholder for views not yet built. Keeps navigation working
//? end-to-end while we build screens one at a time. Each will be replaced by a
//? real screen in its own pass.

import { EmptyState } from '../_components/primitives';
import type { IconName } from '../_components/Icon';

export default function Placeholder({ title, icon }: { title: string; icon: IconName }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 shrink-0">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{title}</h1>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <EmptyState icon={icon} title={`${title} — coming next`} sub="This screen is on the build list. The Board is the first page; the rest follow one at a time." />
      </div>
    </div>
  );
}
