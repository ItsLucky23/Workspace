//? E2/B2 — image-editor essentials around E1: brightness/contrast/saturation adjustments + a draggable text
//? overlay, applied on the
//? same Fabric.js canvas, exported as a NEW image asset (non-destructive — the original stays; the edit is
//? imported via content-import-asset, chained through the normal asset flow). Client-side transforms (no
//? provider), so there's no spend. Fabric is lazily imported (own chunk). Browser-verified in a dev session;
//? the export→import wiring reuses the K1 upload + the tested content-import-asset op.

import { useEffect, useRef, useState } from 'react';

import { useTranslator, i18nNotify as notify } from '@luckystack/core/client';
import type { Canvas as FabricCanvas, FabricImage } from 'fabric';

import { uploadMedia } from '../_functions/uploadMedia';
import { useEscapeKey } from '../_functions/useEscapeKey';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import Icon from './Icon';
import { WsButton } from './primitives';

const CANVAS_MAX = 640;

export default function ImageEditor({ pieceId, asset, onClose }: { pieceId: string; asset: { id: string; url: string }; onClose: () => void }) {
  const translate = useTranslator();
  const { activeWorkspace, runContentOp } = useWorkspaces();
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const imgRef = useRef<FabricImage | null>(null);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [textValue, setTextValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEscapeKey(onClose);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const fabric = await import('fabric');
      const el = canvasElRef.current;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `disposed` is mutated by the async cleanup
      if (disposed || !el) return;
      const img = await fabric.FabricImage.fromURL(asset.url, { crossOrigin: 'anonymous' }).catch(() => null);
      if (!img) return;
      const scale = Math.min(CANVAS_MAX / (img.width || CANVAS_MAX), CANVAS_MAX / (img.height || CANVAS_MAX), 1);
      const w = Math.round((img.width || CANVAS_MAX) * scale);
      const h = Math.round((img.height || CANVAS_MAX) * scale);
      const canvas = new fabric.Canvas(el, { width: w, height: h });
      img.scaleX = scale; img.scaleY = scale; img.selectable = false;
      canvas.add(img); canvas.renderAll();
      fabricRef.current = canvas; imgRef.current = img;
      setReady(true);
    })();
    return () => { disposed = true; void fabricRef.current?.dispose(); fabricRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.url]);

  //? Re-apply the adjustment filters whenever a slider moves.
  useEffect(() => {
    const img = imgRef.current;
    const canvas = fabricRef.current;
    if (!img || !canvas) return;
    void (async () => {
      const { filters } = await import('fabric');
      img.filters = [
        new filters.Brightness({ brightness }),
        new filters.Contrast({ contrast }),
        new filters.Saturation({ saturation }),
      ];
      img.applyFilters();
      canvas.renderAll();
    })();
  }, [brightness, contrast, saturation]);

  //? B2 — add a draggable, editable text overlay (Fabric IText). It stays interactive on the canvas and is
  //? baked into the exported PNG (the same toDataURL path), so no extra export handling is needed.
  const addText = (): void => {
    const canvas = fabricRef.current;
    const t = textValue.trim();
    if (!canvas || t.length === 0) return;
    void (async () => {
      const fabric = await import('fabric');
      const text = new fabric.IText(t, { left: canvas.width / 2, top: canvas.height / 2, originX: 'center', originY: 'center', fill: '#ffffff', fontSize: 28, fontFamily: 'sans-serif', stroke: '#000000', strokeWidth: 1 });
      canvas.add(text); canvas.setActiveObject(text); canvas.renderAll();
      setTextValue('');
    })();
  };

  const exportImage = async (): Promise<File | null> => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return new File([blob], 'edited.png', { type: 'image/png' });
  };

  const apply = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      const file = await exportImage();
      if (!file) { notify.error({ key: 'workspaces.imageEditor.exportFailed' }); setBusy(false); return; }
      const uploaded = await uploadMedia(file, activeWorkspace.id);
      if (!uploaded) { notify.error({ key: 'workspaces.imageEditor.exportFailed' }); setBusy(false); return; }
      runContentOp('content-import-asset', pieceId, { url: uploaded.url, kind: 'image' });
      notify.success({ key: 'workspaces.imageEditor.saved' });
      setBusy(false);
      onClose();
    })();
  };

  const slider = (label: string, value: number, set: (n: number) => void): React.ReactNode => (
    <label className="flex items-center gap-2 text-sm text-common">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <input type="range" min={-0.6} max={0.6} step={0.02} value={value} onChange={(e) => { set(Number(e.target.value)); }} className="accent-primary flex-1" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div className="rounded-2xl border border-container1-border bg-background p-4 max-w-3xl w-full flex flex-col gap-3" onClick={(e) => { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.imageEditor.title' })}</div>
          <button type="button" onClick={onClose} className="text-muted hover:text-title cursor-pointer"><Icon name="xmark" /></button>
        </div>
        <div className="flex items-center justify-center rounded-xl border border-container1-border bg-container1 p-2 overflow-auto">
          <canvas ref={canvasElRef} className="rounded-lg" />
        </div>
        <div className="flex flex-col gap-2">
          {slider(translate({ key: 'workspaces.imageEditor.brightness' }), brightness, setBrightness)}
          {slider(translate({ key: 'workspaces.imageEditor.contrast' }), contrast, setContrast)}
          {slider(translate({ key: 'workspaces.imageEditor.saturation' }), saturation, setSaturation)}
        </div>
        {/* B2 — text overlay: type + add a draggable text object to the canvas. */}
        <div className="flex items-center gap-2">
          <input type="text" value={textValue} onChange={(e) => { setTextValue(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') addText(); }} placeholder={translate({ key: 'workspaces.imageEditor.textPlaceholder' })} className="flex-1 rounded-lg border border-container1-border bg-background px-2 py-1 text-sm text-common" />
          <WsButton variant="ghost" icon="plus" onClick={addText} disabled={textValue.trim().length === 0}>{translate({ key: 'workspaces.imageEditor.addText' })}</WsButton>
        </div>
        <div className="flex items-center justify-end gap-2">
          <WsButton icon="rotate-left" onClick={() => { setBrightness(0); setContrast(0); setSaturation(0); }}>{translate({ key: 'workspaces.imageEditor.reset' })}</WsButton>
          <WsButton icon={busy ? 'spinner' : 'check'} onClick={apply}>{translate({ key: busy ? 'workspaces.imageEditor.saving' : 'workspaces.imageEditor.save' })}</WsButton>
        </div>
        {!ready && <div className="text-xs text-muted">{translate({ key: 'workspaces.editor.loading' })}</div>}
      </div>
    </div>
  );
}
