//? E1 — the headline region editor: draw over an image ("circle a spot") → a white-on-black MASK → the
//? inpaint feature (content-inpaint) region-edits it into a NEW asset (I2 lineage). Fabric.js is loaded LAZILY
//? (dynamic import) so it never lands in a non-editor route chunk (OV-1). The mask is exported from a fresh
//? StaticCanvas holding only the brush strokes — the source image never touches that canvas, so the export is
//? never tainted. Browser-verified in a dev session (server must be running); the op path is unit-tested
//? (contentInpaint) + the provider shape (inpaint).

import { useEffect, useRef, useState } from 'react';

import { useTranslator, i18nNotify as notify } from '@luckystack/core/client';
import type { Canvas as FabricCanvas } from 'fabric';

import { uploadMedia } from '../_functions/uploadMedia';
import { useEscapeKey } from '../_functions/useEscapeKey';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import Icon from './Icon';
import { WsButton } from './primitives';

const CANVAS_MAX = 640;

export default function ImageRegionEditor({ pieceId, asset, onClose }: { pieceId: string; asset: { id: string; url: string }; onClose: () => void }) {
  const translate = useTranslator();
  const { activeWorkspace, runContentOp } = useWorkspaces();
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const dimsRef = useRef<{ w: number; h: number }>({ w: CANVAS_MAX, h: CANVAS_MAX });
  const [prompt, setPrompt] = useState('');
  const [brush, setBrush] = useState(36);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEscapeKey(onClose);

  //? Lazy-load fabric + set up the drawing surface with the source image as a display-only background.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const fabric = await import('fabric');
      const el = canvasElRef.current;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `disposed` is mutated by the async cleanup
      if (disposed || !el) return;
      const img = await fabric.FabricImage.fromURL(asset.url, { crossOrigin: 'anonymous' }).catch(() => null);
      const natW = img?.width ?? CANVAS_MAX;
      const natH = img?.height ?? CANVAS_MAX;
      const scale = Math.min(CANVAS_MAX / natW, CANVAS_MAX / natH, 1);
      const w = Math.round(natW * scale);
      const h = Math.round(natH * scale);
      dimsRef.current = { w, h };
      const canvas = new fabric.Canvas(el, { width: w, height: h, isDrawingMode: true });
      if (img) { img.scaleX = scale; img.scaleY = scale; img.selectable = false; canvas.backgroundImage = img; }
      const pencil = new fabric.PencilBrush(canvas);
      pencil.width = brush;
      pencil.color = 'rgba(255,80,80,0.55)';
      canvas.freeDrawingBrush = pencil;
      canvas.renderAll();
      fabricRef.current = canvas;
      setReady(true);
    })();
    return () => { disposed = true; void fabricRef.current?.dispose(); fabricRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.url]);

  //? Keep the live brush width in sync.
  useEffect(() => { const b = fabricRef.current?.freeDrawingBrush; if (b) b.width = brush; }, [brush]);

  const clear = () => { const c = fabricRef.current; if (c) { c.remove(...c.getObjects()); c.renderAll(); } };

  //? Export the strokes as a white-on-black mask (fresh StaticCanvas → never tainted by the source image).
  const exportMask = async (): Promise<File | null> => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    const objects = canvas.getObjects();
    if (objects.length === 0) return null;
    const fabric = await import('fabric');
    const { w, h } = dimsRef.current;
    const temp = new fabric.StaticCanvas(undefined, { width: w, height: h, backgroundColor: '#000000' });
    for (const o of objects) { const cloned = await o.clone(); cloned.set({ stroke: '#ffffff', fill: '#ffffff', opacity: 1 }); temp.add(cloned); }
    temp.renderAll();
    const dataUrl = temp.toDataURL({ format: 'png', multiplier: 1 });
    void temp.dispose();
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return new File([blob], 'mask.png', { type: 'image/png' });
  };

  const apply = () => {
    if (busy) return;
    if (!prompt.trim()) { notify.error({ key: 'workspaces.editor.needPrompt' }); return; }
    setBusy(true);
    void (async () => {
      const maskFile = await exportMask();
      if (!maskFile) { notify.error({ key: 'workspaces.editor.needRegion' }); setBusy(false); return; }
      const uploaded = await uploadMedia(maskFile, activeWorkspace.id);
      if (!uploaded) { notify.error({ key: 'workspaces.editor.maskFailed' }); setBusy(false); return; }
      runContentOp('content-inpaint', pieceId, { referenceUrl: asset.url, maskUrl: uploaded.url, prompt: prompt.trim(), parentAssetId: asset.id });
      notify.success({ key: 'workspaces.editor.applied' });
      setBusy(false);
      onClose();
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div className="rounded-2xl border border-container1-border bg-background p-4 max-w-3xl w-full flex flex-col gap-3" onClick={(e) => { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.editor.title' })}</div>
          <button type="button" onClick={onClose} className="text-muted hover:text-title cursor-pointer"><Icon name="xmark" /></button>
        </div>
        <div className="text-sm text-muted">{translate({ key: 'workspaces.editor.hint' })}</div>
        <div className="flex items-center justify-center rounded-xl border border-container1-border bg-container1 p-2 overflow-auto">
          <canvas ref={canvasElRef} className="rounded-lg" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-common">
            {translate({ key: 'workspaces.editor.brush' })}
            <input type="range" min={8} max={80} value={brush} onChange={(e) => { setBrush(Number(e.target.value)); }} className="accent-primary" />
          </label>
          <WsButton icon="eraser" onClick={clear}>{translate({ key: 'workspaces.editor.clear' })}</WsButton>
        </div>
        <input value={prompt} onChange={(e) => { setPrompt(e.target.value); }} placeholder={translate({ key: 'workspaces.editor.promptPlaceholder' })} className="h-10 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title placeholder:text-disabled focus:outline-none focus:border-primary" />
        <div className="flex items-center justify-end gap-2">
          <WsButton icon={busy ? 'spinner' : 'wand-magic-sparkles'} onClick={apply}>{translate({ key: busy ? 'workspaces.editor.applying' : 'workspaces.editor.apply' })}</WsButton>
        </div>
        {!ready && <div className="text-xs text-muted">{translate({ key: 'workspaces.editor.loading' })}</div>}
      </div>
    </div>
  );
}
