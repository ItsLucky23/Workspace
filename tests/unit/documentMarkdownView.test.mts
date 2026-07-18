//? Documents markdown preview regression: Mermaid fence languages are case-insensitive.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import MarkdownView from '../../src/workspaces/_components/MarkdownView.tsx';
import { assert, report } from '../_helpers.mts';

const output = renderToStaticMarkup(createElement(MarkdownView, { markdown: '```MERMAID\nflowchart TD\n  A --> B\n```' }));
assert(output.includes('flex justify-center'), 'an upper-case Mermaid fence renders as a diagram container');
assert(!output.includes('<pre'), 'an upper-case Mermaid fence does not fall back to a code block');

report('documentMarkdownView');
