//? DESIGN_DOCS_PROGRAM Phase 2.4 — export fidelity of the md→html renderer: links, images, fenced code
//? blocks, horizontal rules, heading anchors, and a table of contents. Pure (no container, no DB).

import { mdToHtmlBody, standaloneHtml, buildToc, inlineMediaImages } from '../../server/documents/export.ts';
import { assert, report } from '../_helpers.mts';

/* -------------------------------------------------------------- links + images */

const links = mdToHtmlBody('See [the spec](https://example.com/spec) for details.');
assert(links.includes('<a href="https://example.com/spec">the spec</a>'), 'a markdown link renders as an anchor');

const img = mdToHtmlBody('![a wireframe](https://cdn.example.com/wf.png)');
assert(img.includes('<img src="https://cdn.example.com/wf.png" alt="a wireframe" />'), 'a markdown image renders as an img');

//? Security: a javascript: url is neutralized to '#'.
const evil = mdToHtmlBody('[click](javascript:alert(1))');
assert(evil.includes('href="#"') && !evil.includes('javascript:'), 'a javascript: link is dropped to #');

//? A bare number surrounded by spaces must survive (the NUL-placeholder scheme must not eat it).
const bareNum = mdToHtmlBody('do step 3 of the plan');
assert(bareNum.includes('do step 3 of the plan'), 'a standalone " 3 " in prose is not corrupted');

/* -------------------------------------------------------------- fenced code */

const code = mdToHtmlBody('```ts\nconst x = 1 < 2;\n```');
assert(code.includes('<pre class="code"') && code.includes('data-lang="ts"'), 'a fenced block renders as pre.code with its language');
assert(code.includes('const x = 1 &lt; 2;'), 'code content is escaped, not inline-processed');
//? Markdown syntax INSIDE a code fence must not be parsed as a table/list.
const codeWithPipes = mdToHtmlBody('```\n| a | b |\n| - | - |\n```');
assert(!codeWithPipes.includes('<table'), 'a table inside a code fence stays literal');

/* -------------------------------------------------------------- hr + heading anchors */

assert(mdToHtmlBody('---').includes('<hr />'), 'a --- line renders a horizontal rule');
assert(mdToHtmlBody('## System decisions').includes('<h2 id="system-decisions">'), 'headings get anchor ids');

/* -------------------------------------------------------------- TOC */

const doc = '# Title\n\n## Requirements\n\ntext\n\n## Architecture\n\ntext\n\n### Data model\n\ntext';
const toc = buildToc(doc);
assert(toc.includes('<nav class="toc">'), 'a doc with >=3 headings gets a TOC');
assert(toc.includes('href="#requirements"') && toc.includes('href="#data-model"'), 'TOC links to heading anchors');
assert(buildToc('# Only\n\n## One') === '', 'a short doc (<3 headings) gets no TOC');
//? A heading inside a code fence is NOT a TOC entry.
assert(!buildToc('## A\n\n## B\n\n```\n## Not a heading\n```').includes('not-a-heading'), 'headings inside code are ignored by the TOC');

/* -------------------------------------------------------------- standaloneHtml self-contained */

const page = standaloneHtml('My Doc', doc);
assert(page.includes('<!doctype html>') && page.includes('<title>My Doc</title>'), 'standalone page has a doctype + title');
assert(page.includes('pre.code{') && page.includes('.toc{'), 'standalone CSS covers code blocks + TOC');

//? A remote image is left as-is by the media-inliner (only local /media/ is embedded).
assert(inlineMediaImages('![x](https://cdn/x.png)') === '![x](https://cdn/x.png)', 'remote images are not touched by the inliner');

report('documentExportFidelity');
