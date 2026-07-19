//? content/settings — the transient "saved" confirmation shown next to a save button after a write-only
//? save (keys, budget, brand context…). One shared shape so every card confirms the same way.

import Icon from '../../_components/Icon';

export function SavedNote({ text }: { text: string }) {
  return (
    <span className={`text-xs text-correct flex items-center gap-1`}>
      <Icon name="circle-check" /> {text}
    </span>
  );
}
