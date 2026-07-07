//? Reusable bring-your-own-media upload button (FREEDOM_PROGRAM K1). Opens a file picker, uploads the file
//? to `/media/upload` (uploadMedia), and calls `onUploaded(url, kind)`. Used for the reference-image picker
//? (upload a reference) + the "import your own asset" action on a content piece.

import { useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { uploadMedia } from '../_functions/uploadMedia';
import Icon, { type IconName } from './Icon';

export function MediaUploadButton({ workspaceId, accept, labelKey, icon = 'plus', onUploaded }: { workspaceId: string; accept: string; labelKey: string; icon?: IconName; onUploaded: (url: string, kind: string) => void }) {
  const translate = useTranslator();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    void uploadMedia(file, workspaceId).then((r) => { setBusy(false); if (r) onUploaded(r.url, r.kind); });
  };
  return (
    <div className="contents">
      <input ref={ref} type="file" accept={accept} onChange={onChange} className="hidden" />
      <button
        type="button" disabled={busy} onClick={() => { ref.current?.click(); }}
        className="inline-flex items-center gap-2 rounded-lg border border-container2-border bg-container2 hover:bg-container2-hover px-3 py-2 text-sm font-medium text-title disabled:opacity-50 cursor-pointer motion-safe:active:scale-[0.98]"
      >
        {busy ? <span className="w-4 h-4 rounded-full border-2 border-container2-border border-t-primary animate-spin" /> : <Icon name={icon} />}
        {translate({ key: labelKey })}
      </button>
    </div>
  );
}
