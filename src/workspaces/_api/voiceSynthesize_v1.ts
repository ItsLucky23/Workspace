/** @docs owner ItsLucky23 */
//? Workspaces — VO text-to-speech (DOCUMENTS_AND_SKILLS). Synthesizes an Assistant reply to audio (the
//? "speak replies" opt-in), via the metered media 'tts' feature. Membership-gated; budget-guarded +
//? spend-recorded server-side. Returns the served audio url (or an honest stub without a key).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { synthesizeSpeech } from '../../../server/voice/voice';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; text: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, text } = data;
  if (!workspaceId || typeof text !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  const res = await synthesizeSpeech(functions.db.prisma, workspaceId, text);
  if (!res.ok || !res.url) return { status: 'error', errorCode: res.error ?? 'voice.ttsFailed' };
  return { status: 'success', result: { url: res.url, stub: res.stub === true } };
};
