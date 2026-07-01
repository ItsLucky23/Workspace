import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { getProjectConfig, getUploadsDir, processUpload } from '@luckystack/core';

//? Themes the framework recognises (mirrors `defaultTheme` in @luckystack/core).
const ALLOWED_THEMES = new Set<string>(['light', 'dark']);
//? A language is an i18n locale code — a short lowercase identifier (`en`,
//? `nl`, `pt-BR`). We don't have the consumer's locale list in a handler, so
//? bound the shape instead of letting an arbitrary string into the session.
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/;
//? Avatar upload guards: only raster image types sharp can decode, and a hard
//? byte cap applied BEFORE the sharp decode so a hostile data: URL can't drive
//? a decompression-bomb / memory-exhaustion attack.
const ALLOWED_AVATAR_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface ApiParams {
  data: {
    name?: string;
    theme?: SessionLayout['theme'];
    language?: SessionLayout['language'];
    avatar?: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {

  const { avatar, name, theme, language } = data;
  const UPLOADS_DIR = getUploadsDir();

  if (avatar) {
    const matches = /^data:(.+);base64,(.+)$/.exec(avatar);
    if (!matches) {
      return { status: "error", errorCode: 'avatar.invalidFormat' };
    }
    const contentType = matches[1];
    if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
      return { status: 'error', errorCode: 'avatar.invalidFormat' };
    }
    const buffer = Buffer.from(matches[2], "base64");
    if (buffer.byteLength > AVATAR_MAX_BYTES) {
      return { status: 'error', errorCode: 'avatar.uploadFailed' };
    }
    const fileName = `${user.id}.webp`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    //? `processUpload` handles the onUploadStart / onUploadComplete hooks
    //? around our sharp encode-and-save callback. The framework owns the
    //? hook contract; we just provide the encoder.
    const result = await processUpload({
      userId: user.id,
      contentType,
      buffer,
      uploadKind: 'avatar',
      fileName,
      encodeAndSave: async (raw) => {
        await mkdir(UPLOADS_DIR, { recursive: true });
        await sharp(raw).webp({ quality: 80 }).toFile(filePath);
        const savedStat = await stat(filePath).catch(() => null);
        return savedStat?.size ?? raw.byteLength;
      },
    });

    if (result.status === 'rejected') {
      return { status: 'error', errorCode: result.errorCode };
    }
    if (result.status === 'error') {
      return { status: 'error', errorCode: 'avatar.uploadFailed' };
    }
  }

  //? Validate every field before it reaches the session/DB. `theme`/`language`
  //? are compile-time-only on SessionLayout, so a hijacked session could POST
  //? arbitrary values; `name` would otherwise bypass the register-path
  //? `auth.nameMaxLength` policy. Mirror updatePreferences' allow-list shape.
  if (name !== undefined && (typeof name !== 'string' || name.length > getProjectConfig().auth.nameMaxLength)) {
    return { status: 'error', errorCode: 'login.nameCharacterLimit' };
  }
  if (theme !== undefined && (typeof theme !== 'string' || !ALLOWED_THEMES.has(theme))) {
    return { status: 'error', errorCode: 'api.invalidInputType' };
  }
  if (language !== undefined && (typeof language !== 'string' || !LANGUAGE_RE.test(language))) {
    return { status: 'error', errorCode: 'api.invalidInputType' };
  }

  let newData: Partial<Pick<SessionLayout, 'avatar' | 'name' | 'theme' | 'language'>> = {};

  if (avatar) newData = { ...newData, avatar: user.id }
  if (name) newData = { ...newData, name }
  if (theme) newData = { ...newData, theme }
  if (language) newData = { ...newData, language }

  if (!user.token) return { status: 'error', errorCode: 'session.invalid' }

  await functions.db.prisma.user.update({
    where: { id: user.id },
    data: newData
  })

  await functions.session.saveSession(user.token, { ...user, ...newData });

  return { status: 'success', result: {} }
};
