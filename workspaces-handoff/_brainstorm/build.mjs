// Build script: reads the 8 module markdown reports and emits a single
// self-contained interactive interview.html. Re-runnable: `node build.mjs`.
// Parsing is tolerant of the 3 heading/option dialects the agents produced.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// Two rounds. Round 1 = the original deep brainstorm. Round 2 = the broader,
// scope-first questionnaire (built from round2/, separate localStorage key).
const ROUND = ['2', '3'].includes(process.argv[2]) ? Number(process.argv[2]) : 1;
const CONFIGS = {};

CONFIGS[2] = {
  moddir: join(DIR, 'round2'),
  out: 'interview-scope.html',
  title: 'Workspaces — Scope-ronde',
  subtitle: 'Bredere vragen om de scope van elke tool te verduidelijken. Mijn begrip van je visie staat bovenaan — corrigeer waar ik ernaast zit. Antwoorden worden lokaal opgeslagen; klik Exporteer om ze terug te geven. — 2026-06-15',
  storageKey: 'workspaces-scope-answers-v1',
  introSummary: 'Zo begrijp ik je visie nu — lees + corrigeer',
  sectionLabel: 'Context bij deze tool',
  exportTitle: 'Workspaces — Scope-ronde — mijn antwoorden',
  download: 'workspaces-scope-antwoorden.md',
  introFile: '00-vision.md',
  modules: [
    ['tools-framework',  'Tools als pagina’s — het gedeelde raamwerk'],
    ['designer-scope',   'Designer Studio — scope'],
    ['marketing-scope',  'Marketing — scope (V1 = setup, niet functioneel)'],
    ['document-scope',   'Document Studio — scope'],
    ['interviewer-scope','Interviewer — scope'],
    ['pipeline-link',    'Koppeling tool-output ↔ tickets/board'],
    ['new-features',     'Nieuwe tool-ideeën van mij'],
  ],
};
CONFIGS[1] = {
  moddir: join(DIR, 'modules'),
  out: 'interview.html',
  title: 'Workspaces — Modules Brainstorm',
  subtitle: 'Mijn mening + extra ideeën + open vragen per module. Beantwoord wat je wilt (klik een optie en/of typ een toelichting). Alles wordt lokaal in je browser opgeslagen. Klik Exporteer om je antwoorden als bestand terug te geven. — 2026-06-14',
  storageKey: 'workspaces-brainstorm-answers-v1',
  introSummary: 'Mijn algemene mening (samenhang & volgorde)',
  sectionLabel: 'Mijn mening, fit, risico’s & extra ideeën',
  exportTitle: 'Workspaces — Modules Brainstorm — mijn antwoorden',
  download: 'workspaces-antwoorden.md',
  introFile: null, // round 1 derives intro from overall-strategy
  modules: [
    ['modules-system',        'Module-systeem (pipeline-flow als module + uitbreidbaar)'],
    ['designer-studio',       'Designer Studio (AI UI-ontwerp + design-skills)'],
    ['interviewer-module',    'Interviewer-module (AI bevraagt je project → a/b/c/d)'],
    ['marketing-module',      'Marketing-module (video/thumbnails/posters met codebase-context)'],
    ['document-studio',       'Document Studio (files/docs uploaden → PDF/Excel/Word genereren met skills)'],
    ['ai-management',         'AI-management (per-module provider/API-key)'],
    ['stack-agnostic-docker', 'Stack-agnostic Docker + AI-bouwt-images + cross-device tickets'],
    ['proposed-new-modules',  'Extra modules die ik (de AI) voorstel'],
    ['overall-strategy',      'Overall: mijn mening, samenhang & volgorde'],
  ],
};
CONFIGS[3] = {
  moddir: join(DIR, 'round3'),
  out: 'interview-deep.html',
  title: 'Workspaces — Diepe ronde (4 kern-tools)',
  subtitle: 'Concrete bouw- en UX-keuzes per tool, op basis van de vastgelegde scope. Document Studio = natuurlijke/professionele kwaliteit (geen AI-detectie-ontwijking). Antwoorden worden lokaal opgeslagen; klik Exporteer om ze terug te geven. — 2026-06-15',
  storageKey: 'workspaces-deep-answers-v1',
  introSummary: 'Vastgelegde scope + wat deze ronde doet',
  sectionLabel: 'Context bij deze tool',
  exportTitle: 'Workspaces — Diepe ronde — mijn antwoorden',
  download: 'workspaces-deep-antwoorden.md',
  introFile: '00-vision.md',
  modules: [
    ['interviewer-deep', 'Interviewer — diepe ronde (bouw #1)'],
    ['designer-deep',    'Designer Studio — diepe ronde'],
    ['marketing-deep',   'Marketing — diepe ronde (V1 = setup)'],
    ['document-deep',    'Document Studio — diepe ronde'],
  ],
};
const CFG = CONFIGS[ROUND];
const MODDIR = CFG.moddir;
const MODULES = CFG.modules;

// ---------- markdown helpers ----------
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function inlineMd(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return t;
}
function plain(s) {
  return s.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
}

// Block-level markdown -> HTML for prose sections (handles paragraphs, lists, tables, code fences, headings).
function blockMd(md) {
  const lines = md.split(/\r?\n/);
  let html = '', i = 0;
  const flushP = (buf) => { if (buf.length) { html += `<p>${inlineMd(buf.join(' '))}</p>`; } return []; };
  let para = [];
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      para = flushP(para);
      i++; let code = [];
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; html += `<pre><code>${esc(code.join('\n'))}</code></pre>`; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) { // table
      para = flushP(para);
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { tbl.push(lines[i]); i++; }
      const rows = tbl.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
        .map(r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
      if (rows.length) {
        html += '<table>';
        rows.forEach((cells, ri) => {
          const tag = ri === 0 ? 'th' : 'td';
          html += '<tr>' + cells.map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join('') + '</tr>';
        });
        html += '</table>';
      }
      continue;
    }
    let hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { para = flushP(para); const lv = Math.min(hm[1].length + 2, 6); html += `<h${lv}>${inlineMd(hm[2])}</h${lv}>`; i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      para = flushP(para); html += '<ul>';
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { html += `<li>${inlineMd(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; }
      html += '</ul>'; continue;
    }
    if (/^\s*$/.test(line)) { para = flushP(para); i++; continue; }
    para.push(line.trim()); i++;
  }
  flushP(para);
  return html;
}

// ---------- per-question parsing ----------
function extractField(body, re) {
  const m = body.match(re);
  if (!m) return '';
  let rest = body.slice(m.index + m[0].length);
  const stop = rest.search(/\n\s*(\*\*[^*\n]+\*\*|---)/);
  if (stop >= 0) rest = rest.slice(0, stop);
  return rest.replace(/^[:\s]*/, '').trim();
}
const OPT_MARK = /\*{1,2}\s*Opties\s*:?\s*\*{1,2}/i; // matches **Opties:** and *Opties:*
function isQuestionBlock(block) {
  if (OPT_MARK.test(block)) return true;
  const head = (block.match(/^\s*###\s+(.+)/) || [])[1] || '';
  return /^(vraag[-\w]*|v-?\d+\b|vraag\s*\d+)/i.test(head.trim());
}
function optRender(txt) {
  const clean = txt.replace(/[`*]/g, '').trim();
  const m = clean.match(/^(.*?)(\s[—–-]\s|:\s)([\s\S]*)$/);
  if (m) return '<strong>' + esc(m[1].trim()) + '</strong>' + esc(m[2]) + esc(m[3]);
  return '<strong>' + esc(clean) + '</strong>';
}
function parseOptions(body) {
  const idx = body.search(OPT_MARK);
  if (idx < 0) return [];
  const region = body.slice(idx).replace(OPT_MARK, '');
  const out = [];
  for (let raw of region.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^---/.test(line)) continue;
    const m = line.match(/^[-*]?\s*\*{0,2}([a-eA-E])[).]\s*(.*)$/);
    if (m) {
      const txt = m[2];
      out.push({ letter: m[1].toLowerCase(), html: optRender(txt), plain: plain(txt), recommended: /aanbevol/i.test(txt) });
    } else if (out.length) {
      out[out.length - 1].html += ' ' + esc(line.replace(/[*`]/g, ''));
      out[out.length - 1].plain += ' ' + plain(line);
    }
  }
  return out;
}
function parseQuestions(body) {
  const parts = body.split(/\n(?=###\s+)/);
  const qs = [];
  for (const part of parts) {
    if (!/^\s*###\s+/.test(part) || !isQuestionBlock(part)) continue;
    const head = part.match(/^\s*###\s+(.+)/);
    let title = head ? head[1].trim() : 'Vraag';
    title = title.replace(/^(V-?\d+\s*[·\-—:.)]\s*|Vraag\s*\d+\s*[—\-:·.)]\s*|vraag[-\w]*\s*[:.)]?\s*)/i, '').trim();
    const rest = part.replace(/^\s*###\s+.+\n?/, '');
    let summary = extractField(rest, /\*\*Samenvatting:?\*\*/i);
    let detailed = extractField(rest, /\*\*Gedetailleerde[^*]*\*\*/i);
    // Fallbacks for the "bold question line + prose + *Opties:*" dialect (overall-strategy, proposed-new-modules).
    const titel = extractField(rest, /\*\*Titel:?\*\*/i);
    if (titel && (!title || /^(vraag[-\w]*|v-?\d+)$/i.test(title))) title = titel;
    const bolds = (rest.match(/\*\*([^*]+?)\*\*/g) || []).map(s => s.replace(/\*\*/g, '').trim()).filter(s => !/:$/.test(s));
    if (!title || /^(vraag[-\w]*|v-?\d+)$/i.test(title)) title = bolds[0] || title || 'Vraag';
    if (!summary) summary = bolds.find(s => s !== title) || '';
    if (!detailed) {
      let r2 = rest; const oi = r2.search(OPT_MARK);
      if (oi >= 0) r2 = r2.slice(0, oi);
      detailed = r2.replace(/\*\*[^*]+\*\*/, '').replace(/\*\*Type:?\*\*[^\n]*/i, '').trim();
    }
    if (plain(summary) === plain(title)) summary = '';
    qs.push({ title, summary: inlineMd(summary), detailed: blockMd(detailed), options: parseOptions(rest) });
  }
  return qs;
}

// ---------- per-file parsing ----------
function splitSections(md) {
  const lines = md.split(/\r?\n/);
  const sections = []; let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) { cur = { title: m[1].trim(), body: [] }; sections.push(cur); }
    else if (cur) cur.body.push(line);
  }
  return sections;
}

const data = { intro: '', modules: [] };
let totalQ = 0;
for (const [key, title] of MODULES) {
  const md = readFileSync(join(MODDIR, key + '.md'), 'utf8');
  const sections = splitSections(md);
  let contextHtml = '', questions = [];
  for (const s of sections) {
    const bodyText = s.body.join('\n').trim();
    const blocks = bodyText.split(/\n(?=###\s+)/);
    const qBlocks = [], cBlocks = [];
    for (const b of blocks) {
      if (/^\s*###\s+/.test(b) && isQuestionBlock(b)) qBlocks.push(b);
      else cBlocks.push(b);
    }
    if (qBlocks.length) questions.push(...parseQuestions(qBlocks.join('\n')));
    const ctx = cBlocks.join('\n').trim();
    if (key === 'overall-strategy' && /mijn mening/i.test(s.title) && !data.intro) {
      data.intro = blockMd(ctx);
    } else if (ctx && !/^vragen$/i.test(s.title.trim())) {
      contextHtml += `<h3>${inlineMd(s.title)}</h3>` + blockMd(ctx);
    }
  }
  totalQ += questions.length;
  data.modules.push({ key, title, contextHtml, questions });
  console.log(`${key}: ${questions.length} vragen, ${questions.reduce((a, q) => a + q.options.length, 0)} opties`);
}
if (CFG.introFile) {
  data.intro = blockMd(readFileSync(join(MODDIR, CFG.introFile), 'utf8'));
}
console.log(`[round ${ROUND}] TOTAAL: ${totalQ} vragen over ${data.modules.length} modules`);

// ---------- HTML template ----------
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${CFG.title}</title>
<style>
:root{--bg:#0e1116;--bg2:#161b22;--bg3:#1c2230;--line:#2a3240;--txt:#d6dde6;--mut:#8a96a6;--ttl:#f2f6fb;--acc:#6aa6ff;--acc2:#2b6fd6;--ok:#3fb950;--warn:#d29922;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--acc)}
.wrap{max-width:1000px;margin:0 auto;padding:0 18px 120px}
header.top{padding:34px 0 14px}
header.top h1{margin:0 0 6px;color:var(--ttl);font-size:26px}
header.top p{margin:0;color:var(--mut)}
.bar{position:sticky;top:0;z-index:20;background:rgba(14,17,22,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:18px}
.bar .inner{max-width:1000px;margin:0 auto;padding:0 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.prog{flex:1;min-width:160px}
.prog .track{height:8px;background:var(--bg3);border-radius:6px;overflow:hidden}
.prog .fill{height:100%;width:0;background:linear-gradient(90deg,var(--acc2),var(--acc));transition:width .25s}
.prog small{color:var(--mut);display:block;margin-top:4px}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:var(--bg3);color:var(--txt);padding:8px 12px}
button:hover{border-color:var(--acc)}
button.primary{background:var(--acc2);border-color:var(--acc2);color:#fff;font-weight:600}
button.ghost{background:transparent}
.saved{color:var(--ok);font-size:13px;opacity:0;transition:opacity .3s}
.saved.on{opacity:1}
.nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
.nav a{font-size:13px;text-decoration:none;color:var(--txt);background:var(--bg2);border:1px solid var(--line);border-radius:20px;padding:5px 11px}
.nav a:hover{border-color:var(--acc)}
.nav a b{color:var(--mut);font-weight:500}
.intro{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:4px 20px 8px;margin-bottom:30px}
details.acc{border:1px solid var(--line);border-radius:10px;background:var(--bg2);margin:10px 0}
details.acc>summary{cursor:pointer;padding:12px 16px;color:var(--ttl);font-weight:600;list-style:none}
details.acc>summary::-webkit-details-marker{display:none}
details.acc>summary::before{content:"▸ ";color:var(--acc)}
details.acc[open]>summary::before{content:"▾ "}
details.acc .body{padding:2px 18px 14px;border-top:1px solid var(--line)}
section.mod{margin:38px 0 0;scroll-margin-top:90px}
section.mod>h2{color:var(--ttl);font-size:20px;border-bottom:2px solid var(--acc2);padding-bottom:8px;display:flex;justify-content:space-between;align-items:baseline;gap:10px}
section.mod>h2 .cnt{font-size:13px;color:var(--mut);font-weight:500}
.q{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
.q.answered{border-left:3px solid var(--ok)}
.q .qt{color:var(--ttl);font-weight:600;font-size:16px;margin:0 0 4px}
.q .sum{color:var(--txt);margin:0 0 6px}
.q details.info{margin:6px 0 10px}
.q details.info summary{cursor:pointer;color:var(--acc);font-size:13px;list-style:none}
.q details.info summary::-webkit-details-marker{display:none}
.q details.info .d{margin-top:8px;padding:10px 14px;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--txt)}
.opt{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin:7px 0;cursor:pointer;background:var(--bg3)}
.opt:hover{border-color:var(--acc)}
.opt.sel{border-color:var(--acc);background:#15243d}
.opt input{margin-top:4px}
.opt .ol b.letter{display:inline-block;min-width:20px;color:var(--acc);font-weight:700;text-transform:uppercase}
.badge{display:inline-block;font-size:11px;background:var(--ok);color:#06210d;border-radius:4px;padding:1px 6px;margin-left:6px;font-weight:700;vertical-align:middle}
.opt.skip{background:transparent;border-style:dashed}
textarea{width:100%;margin-top:9px;background:var(--bg);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;resize:vertical;min-height:54px}
textarea:focus,.opt:focus-within{outline:2px solid var(--acc);outline-offset:1px}
.q .mark{font-size:12px;color:var(--ok);margin-top:6px;display:none}
.q.answered .mark{display:block}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left}
th{background:var(--bg3);color:var(--ttl)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto}
code{background:var(--bg3);padding:1px 5px;border-radius:4px;font-size:13px}
.intro :is(h3,h4){color:var(--ttl)}
.final{margin-top:40px;background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ok);color:#06210d;font-weight:600;padding:10px 18px;border-radius:8px;opacity:0;transition:.3s;pointer-events:none;z-index:50}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.hint{color:var(--mut);font-size:13px}
</style>
</head>
<body>
<div class="bar"><div class="inner">
  <div class="prog"><div class="track"><div class="fill" id="fill"></div></div><small id="ptxt">0 / 0 beantwoord</small></div>
  <span class="saved" id="saved">opgeslagen ✓</span>
  <button class="primary" id="exp">⬇ Exporteer antwoorden</button>
  <button id="cpy">⧉ Kopieer</button>
  <button class="ghost" id="clr">Wis alles</button>
</div></div>

<div class="wrap">
  <header class="top">
    <h1>${CFG.title}</h1>
    <p>${CFG.subtitle}</p>
  </header>

  <details class="acc" open id="introbox"><summary>${CFG.introSummary}</summary><div class="body intro" id="intro"></div></details>

  <div class="nav" id="nav"></div>
  <div id="mods"></div>

  <div class="final">
    <h3 style="margin-top:6px;color:var(--ttl)">Extra ideeën / opmerkingen van mij</h3>
    <p class="hint">Vrij veld — alles wat je kwijt wil dat niet bij een vraag past. Wordt meegenomen in de export.</p>
    <textarea id="freeform" rows="5" placeholder="Jouw eigen ideeën, twijfels, prioriteiten…"></textarea>
  </div>
</div>

<div class="toast" id="toast"></div>

<script id="brainstorm-data" type="application/json">${json}</script>
<script>
const DATA = JSON.parse(document.getElementById('brainstorm-data').textContent);
const KEY = ${JSON.stringify(CFG.storageKey)};
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ store = {}; }
const qid = (mk,i) => mk + '::' + i;

function save(){ localStorage.setItem(KEY, JSON.stringify(store)); flashSaved(); updateProgress(); }
let st;
function flashSaved(){ const s=document.getElementById('saved'); s.classList.add('on'); clearTimeout(st); st=setTimeout(()=>s.classList.remove('on'),900); }
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('on'); setTimeout(()=>t.classList.remove('on'),1800); }

let totalQ=0;
const nav=document.getElementById('nav'), mods=document.getElementById('mods');
document.getElementById('intro').innerHTML = DATA.intro || '<p class="hint">(geen)</p>';

DATA.modules.forEach(m=>{
  totalQ += m.questions.length;
  const a=document.createElement('a'); a.href='#mod-'+m.key;
  a.innerHTML = m.title.split('(')[0].trim()+' <b data-navc="'+m.key+'">0/'+m.questions.length+'</b>';
  nav.appendChild(a);

  const sec=document.createElement('section'); sec.className='mod'; sec.id='mod-'+m.key;
  sec.innerHTML = '<h2>'+esc(m.title)+' <span class="cnt" data-cnt="'+m.key+'">0 / '+m.questions.length+'</span></h2>';
  if(m.contextHtml){
    const d=document.createElement('details'); d.className='acc';
    d.innerHTML='<summary>'+${JSON.stringify(CFG.sectionLabel)}+'</summary><div class="body">'+m.contextHtml+'</div>';
    sec.appendChild(d);
  }
  m.questions.forEach((q,i)=>{
    const id=qid(m.key,i);
    const card=document.createElement('div'); card.className='q'; card.id='q-'+id;
    let h='<p class="qt">'+esc(q.title)+'</p>';
    if(q.summary) h+='<p class="sum">'+q.summary+'</p>';
    if(q.detailed) h+='<details class="info"><summary>ⓘ Gedetailleerde uitleg</summary><div class="d">'+q.detailed+'</div></details>';
    h+='<div class="opts">';
    q.options.forEach(o=>{
      h+='<label class="opt" data-letter="'+o.letter+'"><input type="radio" name="'+id+'" value="'+o.letter+'"><span class="ol"><b class="letter">'+o.letter+')</b> '+o.html+(o.recommended?'<span class="badge">aanbevolen</span>':'')+'</span></label>';
    });
    h+='<label class="opt skip"><input type="radio" name="'+id+'" value="skip"><span class="ol">— n.v.t. / sla over —</span></label>';
    h+='</div><textarea placeholder="Jouw toelichting / eigen antwoord (optioneel)"></textarea>';
    h+='<div class="mark">beantwoord ✓</div>';
    card.innerHTML=h;
    sec.appendChild(card);

    const saved=store[id]||{};
    const ta=card.querySelector('textarea');
    if(saved.notes) ta.value=saved.notes;
    if(saved.choice){ const r=card.querySelector('input[value="'+saved.choice+'"]'); if(r) r.checked=true; }
    card.querySelectorAll('input[type=radio]').forEach(r=>r.addEventListener('change',()=>{
      store[id]=store[id]||{}; store[id].choice=r.value;
      card.querySelectorAll('.opt').forEach(o=>o.classList.toggle('sel', o.contains(r)&&r.checked));
      refreshCard(card,id); save();
    }));
    ta.addEventListener('input',()=>{ store[id]=store[id]||{}; store[id].notes=ta.value; refreshCard(card,id); save(); });
    refreshCard(card,id,true);
  });
  mods.appendChild(sec);
});

const ff=document.getElementById('freeform');
if(store._freeform) ff.value=store._freeform;
ff.addEventListener('input',()=>{ store._freeform=ff.value; save(); });

function isAnswered(id){ const s=store[id]; return !!(s&&((s.choice&&s.choice!=='')||(s.notes&&s.notes.trim()))); }
function refreshCard(card,id,initOnly){
  const ans=isAnswered(id); card.classList.toggle('answered',ans);
  const s=store[id]||{};
  card.querySelectorAll('.opt').forEach(o=>{ const inp=o.querySelector('input'); o.classList.toggle('sel', inp.checked); });
}
function updateProgress(){
  let done=0;
  DATA.modules.forEach(m=>{
    let md=0;
    m.questions.forEach((q,i)=>{ if(isAnswered(qid(m.key,i))){done++;md++;} });
    const c=document.querySelector('[data-cnt="'+m.key+'"]'); if(c)c.textContent=md+' / '+m.questions.length;
    const n=document.querySelector('[data-navc="'+m.key+'"]'); if(n)n.textContent=md+'/'+m.questions.length;
  });
  document.getElementById('fill').style.width=(totalQ?done/totalQ*100:0)+'%';
  document.getElementById('ptxt').textContent=done+' / '+totalQ+' beantwoord';
}
updateProgress();

function buildMarkdown(){
  let out=${JSON.stringify('# ' + CFG.exportTitle + '\n\n')};
  DATA.modules.forEach(m=>{
    let block='';
    m.questions.forEach((q,i)=>{
      const id=qid(m.key,i), s=store[id]||{};
      if(!isAnswered(id)) return;
      block+='### '+q.title+'\\n';
      if(s.choice&&s.choice!=='skip'){ const o=q.options.find(x=>x.letter===s.choice); block+='- Keuze: **'+s.choice.toUpperCase()+'**'+(o?' — '+o.plain:'')+'\\n'; }
      else if(s.choice==='skip'){ block+='- Keuze: _(overgeslagen)_\\n'; }
      if(s.notes&&s.notes.trim()) block+='- Toelichting: '+s.notes.trim().replace(/\\n/g,'\\n  ')+'\\n';
      block+='\\n';
    });
    if(block){ out+='## '+m.title+'\\n\\n'+block; }
  });
  if(store._freeform&&store._freeform.trim()) out+='## Extra ideeën / opmerkingen\\n\\n'+store._freeform.trim()+'\\n';
  if(out.trim()===${JSON.stringify('# ' + CFG.exportTitle)}) out+='\\n_(nog niets beantwoord)_\\n';
  return out;
}
document.getElementById('exp').addEventListener('click',()=>{
  const md=buildMarkdown();
  const blob=new Blob([md],{type:'text/markdown'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=${JSON.stringify(CFG.download)};
  document.body.appendChild(a); a.click(); a.remove();
  navigator.clipboard&&navigator.clipboard.writeText(md).catch(()=>{});
  toast('Geëxporteerd ✓ (ook gekopieerd)');
});
document.getElementById('cpy').addEventListener('click',()=>{
  const md=buildMarkdown();
  if(navigator.clipboard) navigator.clipboard.writeText(md).then(()=>toast('Gekopieerd ✓')).catch(()=>toast('Kopiëren mislukt'));
  else toast('Klembord niet beschikbaar');
});
document.getElementById('clr').addEventListener('click',()=>{
  if(!confirm('Alle antwoorden wissen?')) return;
  store={}; localStorage.removeItem(KEY);
  document.querySelectorAll('input[type=radio]').forEach(r=>r.checked=false);
  document.querySelectorAll('.q textarea').forEach(t=>t.value='');
  ff.value=''; document.querySelectorAll('.q').forEach(c=>c.classList.remove('answered'));
  document.querySelectorAll('.opt').forEach(o=>o.classList.remove('sel'));
  updateProgress(); toast('Gewist');
});
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
</script>
</body>
</html>`;

writeFileSync(join(DIR, CFG.out), html, 'utf8');
console.log('-> ' + CFG.out + ' geschreven (' + (html.length / 1024).toFixed(0) + ' KB)');
