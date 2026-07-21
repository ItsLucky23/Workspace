//? GAP_SCAN G4 — the shared "pick an existing asset" surface.
//?
//? There were three independent implementations of this (the documents image picker, the content library
//? grid, the timeline's scene picker), each deriving its own list from `content.pieces` with slightly
//? different rules — which is exactly why a brand mascot made for one piece stayed invisible everywhere
//? else. This renders the WORKSPACE-WIDE library (`content.assetLibrary`, starred first) from one place.
//?
//? Every input is a prop, no `useWorkspaces()`: the picker has to work inside a `menuHandler` overlay,
//? which renders above the provider (lesson 0011).

import { backendUrl } from '../../../config';
import Icon from './Icon';

export interface PickableAsset {
  id: string;
  kind: string;
  url: string;
  pieceTitle: string;
  starred: boolean;
}

//? `/media/*` is served by the BACKEND; rendering it against the frontend origin is the bug this helper
//? exists to prevent (the old documents picker had exactly that).
function assetHref(url: string): string {
  return url.startsWith('/media/') ? `${backendUrl}${url}` : url;
}

//? Image / silent video frame / a kind icon for audio-ish assets.
export function AssetThumb({ asset }: { asset: PickableAsset }) {
  if (asset.kind === 'image' || asset.kind === 'thumbnail') return <img src={assetHref(asset.url)} alt={asset.pieceTitle} className="w-full h-full object-cover" />;
  if (asset.kind === 'video' || asset.kind === 'render' || asset.kind === 'avatar') return <video src={assetHref(asset.url)} muted playsInline className="w-full h-full object-cover" />;
  return <Icon name="wave-square" className="text-2xl text-muted" />;
}

export interface AssetPickerProps {
  assets: PickableAsset[];
  onPick: (asset: PickableAsset) => void;
  //? Star / unstar from wherever the picker is shown — curating the library is most natural at the moment
  //? you notice you keep reaching for the same asset.
  onToggleStar?: (asset: PickableAsset) => void;
  emptyLabel: string;
  starHint?: string;
  pickHint?: string;
  //? Narrow to one kind (the document picker wants stills; a music slot wants audio).
  kinds?: string[];
  limit?: number;
}

export function AssetPicker({ assets, onPick, onToggleStar, emptyLabel, starHint, pickHint, kinds, limit = 24 }: AssetPickerProps) {
  const visible = (kinds && kinds.length > 0 ? assets.filter((a) => kinds.includes(a.kind)) : assets).slice(0, limit);
  if (visible.length === 0) return <div className="text-xs text-muted py-3">{emptyLabel}</div>;
  return (
    <div className="flex gap-2 flex-wrap mt-1">
      {visible.map((asset) => (
        <div key={asset.id} className="w-28 shrink-0">
          <button
            type="button" onClick={() => { onPick(asset); }} title={pickHint}
            className="block w-28 h-20 rounded-lg border border-container1-border bg-container2 overflow-hidden hover:border-primary-border transition-colors cursor-pointer"
          >
            <AssetThumb asset={asset} />
          </button>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[11px] text-muted truncate flex-1">{asset.pieceTitle}</span>
            {onToggleStar && (
              <button
                type="button" onClick={() => { onToggleStar(asset); }} title={starHint}
                className={`text-[11px] cursor-pointer shrink-0 ${asset.starred ? 'text-warning' : 'text-disabled hover:text-muted'}`}
              >
                <Icon name="star" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
