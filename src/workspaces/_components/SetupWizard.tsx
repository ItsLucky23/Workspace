//? Compatibility shim: the old media-only wizard no longer owns setup. The maintained checklist is
//? the single setup surface; keep this export temporarily for any stale consumer during the merge.

import SetupChecklist from './SetupChecklist';

export default function SetupWizard({ onClose }: { onClose: () => void }) {
  void onClose;
  return <SetupChecklist />;
}
