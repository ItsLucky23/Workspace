/**
 * Script to generate static Tailwind variant safelist
 * Run with: node scripts/generateContainerSafelist.js
 * 
 * Only generates the most commonly used variants to keep the file manageable.
 */

import { tailwindcssClasses } from '../src/sandbox/_functions/codeEditor/tailwindcss/classes.js';
import { writeFileSync } from 'fs';

// Container query breakpoints
const CONTAINER_BREAKPOINTS = ['@sm', '@md', '@lg', '@xl', '@2xl'];

// Only the most commonly used state variants
const STATE_VARIANTS = [
  'hover',
  'focus',
  'active',
  'disabled',
  'dark',
];

// Generate variant combinations
const allClasses = ['@container'];

for (const cls of tailwindcssClasses) {
  // Container breakpoint variants: @sm:flex, @md:hidden, etc.
  for (const bp of CONTAINER_BREAKPOINTS) {
    allClasses.push(`${bp}:${cls}`);
  }

  // State variants: hover:bg-blue-500, focus:border-red-500, etc.
  for (const state of STATE_VARIANTS) {
    allClasses.push(`${state}:${cls}`);
  }
}

// Write to a file that Tailwind can scan
writeFileSync('container-safelist.txt', allClasses.join('\n'));

console.log(`Generated ${allClasses.length.toLocaleString()} variant classes`);
console.log(`  - ${tailwindcssClasses.length} base classes`);
console.log(`  - ${CONTAINER_BREAKPOINTS.length} container breakpoints`);
console.log(`  - ${STATE_VARIANTS.length} state variants`);
