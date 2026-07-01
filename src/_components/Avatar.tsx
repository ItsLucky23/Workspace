import { backendUrl, SessionLayout } from "config";

import { useEffect, useRef, useState } from "react";

type UserType = SessionLayout | { name: string; avatar?: string; avatarFallback?: string };
type TextSize = `text-${'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | '8xl' | '9xl'}`;

type AvatarState = 'avatar' | 'fallback';

const resolveAvatarUrl = (avatar: string) =>
  avatar.startsWith('http') ? avatar : `${backendUrl}/uploads/${avatar}`;

//? Identity of an avatar image with the `?v=` cache-buster stripped. Two URLs
//? for the same file that differ only by `?v=` collapse to one id, so an
//? unrelated session update that merely re-stamps `?v=` is recognised as the
//? same image and never disturbs what is painted.
const getAvatarFileId = (avatar: string | undefined): string | null => {
  if (!avatar) return null;
  const url = resolveAvatarUrl(avatar);
  const path = url.split('?')[0] ?? '';
  const fileName = path.split('/').pop() ?? path;
  return fileName.replace(/\.[^/.]+$/, '') || fileName;
};

interface AvatarProps {
  user: UserType;
  textSize?: TextSize;
}

export default function Avatar({ user, textSize = 'text-lg' }: AvatarProps) {
  const candidateUrl = user.avatar ? resolveAvatarUrl(user.avatar) : null;
  const candidateId = getAvatarFileId(user.avatar);

  //? What is actually painted — deliberately decoupled from `user.avatar`.
  //? `user.avatar` is re-stamped with a fresh `?v=` on every session update
  //? (see SessionProvider), which previously remounted the <img> and made the
  //? avatar flash. We only adopt a new value once an off-screen probe confirms
  //? its load state/identity genuinely differs from what is already shown.
  const [displayed, setDisplayed] = useState<{ url: string | null; state: AvatarState }>(
    () => (candidateUrl ? { url: candidateUrl, state: 'avatar' } : { url: null, state: 'fallback' }),
  );

  //? Mirror of the committed identity, read by the probe's async callbacks so
  //? they compare against the latest value WITHOUT putting `displayed` in the
  //? effect deps (which would re-probe on every commit and loop).
  const committedRef = useRef<{ id: string | null; state: AvatarState }>({
    id: candidateId,
    state: candidateUrl ? 'avatar' : 'fallback',
  });

  const fallBackToPlaceholder = () => {
    //? Already on the fallback ⇒ do nothing (no flicker between two identical
    //? fallbacks). Otherwise drop to the fallback.
    if (committedRef.current.state === 'fallback') return;
    committedRef.current = { id: candidateId, state: 'fallback' };
    setDisplayed({ url: null, state: 'fallback' });
  };

  useEffect(() => {
    if (!candidateUrl) {
      if (committedRef.current.state !== 'fallback' || committedRef.current.id !== null) {
        committedRef.current = { id: null, state: 'fallback' };
        setDisplayed({ url: null, state: 'fallback' });
      }
      return;
    }

    //? Off-screen probe — never added to the DOM, thrown away on cleanup.
    const probe = new Image();
    const handleLoad = () => {
      const current = committedRef.current;
      //? Same file, already shown as an avatar ⇒ only the `?v=` changed. Leave
      //? the painted <img> exactly as it is — this is what removes the flash.
      if (current.id === candidateId && current.state === 'avatar') return;
      committedRef.current = { id: candidateId, state: 'avatar' };
      setDisplayed({ url: candidateUrl, state: 'avatar' });
    };
    const handleError = () => {
      if (committedRef.current.state === 'fallback') return;
      committedRef.current = { id: candidateId, state: 'fallback' };
      setDisplayed({ url: null, state: 'fallback' });
    };
    probe.addEventListener('load', handleLoad);
    probe.addEventListener('error', handleError);
    probe.src = candidateUrl;

    return () => {
      probe.removeEventListener('load', handleLoad);
      probe.removeEventListener('error', handleError);
    };
  }, [candidateUrl, candidateId]);

  if (displayed.state === 'fallback' || !displayed.url) {
    return (
      <div
        className={`rounded-full aspect-square text-title-primary flex items-center justify-center w-full h-full select-none ${textSize}`}
        style={{ backgroundColor: user.avatarFallback ?? '#9ca3af' }}
      >
        {user.name ? user.name[0]?.toUpperCase() : null}
      </div>
    );
  }

  return (
    <img
      className="rounded-full w-full h-full select-none object-cover aspect-square"
      src={displayed.url}
      alt={user.name ?? ''}
      onError={fallBackToPlaceholder}
    />
  );
}
