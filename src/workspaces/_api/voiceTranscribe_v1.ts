/** @docs owner ItsLucky23 */
//? Workspaces — VO speech-to-text (DOCUMENTS_AND_SKILLS). Takes an uploaded audio `/media/...` url
//? (recorded via the browser MediaRecorder + the existing /media upload) and returns its transcript.
//? Membership-gated; read-only (no write) — the transcript rides the existing chat/ticket text paths.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { transcribeAudio } from '../../../server/voice/voice';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; audioUrl: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, audioUrl } = data;
  if (!workspaceId || typeof audioUrl !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  const res = await transcribeAudio(workspaceId, audioUrl);
  if (!res.ok) return { status: 'error', errorCode: res.error ?? 'voice.sttFailed' };
  return { status: 'success', result: { text: res.text } };
};
