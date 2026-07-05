//? Test for the Interviewer agent-role prompt builder + registration. The prompt builder is pure
//? (no DB/provider), so it runs anywhere. Registration is checked against the AgentRole registry.

import { assert, eq, report } from '../_helpers.mts';

const roleMod = await import('../../server/interviewer/role');
const scraperMod = await import('../../server/scraper/role');
const registry = await import('../../server/automation/agentRoles');

try {
  // ---- buildInterviewerPrompt (pure) ----
  const full = roleMod.buildInterviewerPrompt('');
  assert(full.system.toLowerCase().includes('improvement') || full.system.toLowerCase().includes('improve'), 'system frames improvement proposals');
  assert(full.prompt.includes('the whole project'), 'empty focus → whole project');
  const scoped = roleMod.buildInterviewerPrompt('the auth flow');
  assert(scoped.prompt.includes('the auth flow'), 'a focus narrows the prompt');
  assert(full.system.toLowerCase().includes('markdown'), 'asks for a markdown list');

  // ---- RAG grounding ----
  const grounded = roleMod.buildInterviewerPrompt('', '// src/auth.ts\nfunction login() {}');
  assert(grounded.prompt.includes('src/auth.ts') && grounded.prompt.includes('GROUND'), 'RAG context grounds the prompt');
  assert(!roleMod.buildInterviewerPrompt('', '').prompt.includes('GROUND'), 'no context → no grounding block');

  // ---- registration (interviewer + scraper) ----
  registry.resetAgentRoles();
  roleMod.registerInterviewerRole();
  scraperMod.registerScraperRole();
  const role = registry.getAgentRole('interviewer');
  assert(role !== undefined, 'the interviewer role registers');
  eq(role?.mutates, false, 'the interviewer proposes only (mutates:false)');
  eq(role?.label, 'Interviewer', 'the role has a label');
  assert(registry.listAgentRoles().some((r) => r.key === 'interviewer'), 'it appears in listAgentRoles (the snapshot source)');
  const scraper = registry.getAgentRole('scraper');
  assert(scraper !== undefined && scraper.mutates === false, 'the scraper role registers (propose-only)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/interviewerRole.test.mts');
