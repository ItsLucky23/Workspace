//? Studio-local shared helpers (no components): defensive readers for the AI-generated `unknown`
//? artifact content, the shared input class, and the client-side HTML→PNG rasterizer (#170).

export { INPUT_CLS_FULL as inputCls } from '../../_components/settings';

//? ---- content readers (the AI content is `unknown`; read defensively, no casts to `any`) ----
export function asRecord(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
export function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }
export function asStrArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }

//? #170 — client-side render-to-PNG: rasterize the generated HTML card into a social-sized PNG via an
//? SVG <foreignObject> → <img> → <canvas> → blob, then download it. Fully client-side (no image provider).
//? Best-effort: an external image / cross-origin asset TAINTS the canvas so `toBlob` yields null — we notify
//? and the user falls back to Copy HTML (the owner picked client render-to-PNG knowing this limit).
const PNG_W = 1200;
const PNG_H = 630;
export function downloadHtmlAsPng(html: string, onFail: () => void): void {
  //? Wrap the card in a namespaced foreignObject at social-card dimensions.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(PNG_W)}" height="${String(PNG_H)}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${String(PNG_W)}px;height:${String(PNG_H)}px;overflow:hidden;background:#ffffff">${html}</div></foreignObject></svg>`;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.addEventListener('load', () => {
    const canvas = document.createElement('canvas');
    canvas.width = PNG_W; canvas.height = PNG_H;
    const cx = canvas.getContext('2d');
    if (!cx) { onFail(); return; }
    cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, PNG_W, PNG_H);
    cx.drawImage(img, 0, 0);
    //? toBlob is null when the canvas is tainted (external asset) — honest failure, not a broken file.
    canvas.toBlob((blob) => {
      if (!blob) { onFail(); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'design.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });
  img.addEventListener('error', () => { onFail(); });
  img.src = svgUrl;
}
