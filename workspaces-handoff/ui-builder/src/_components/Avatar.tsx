import { backendUrl, SessionLayout } from "config";
import { useAvatarContext } from "./AvatarProvider";

export default function Avatar({
  user,
  textSize,
}: {
  user: SessionLayout 
  | {name: string, avatar?: string, avatarFallback?: string},
  textSize?: "text-sm" | "text-base" | "text-lg" | "text-xl" | "text-2xl" | "text-3xl" | "text-4xl" | "text-5xl" | "text-6xl" | "text-7xl" | "text-8xl" | "text-9xl"
}) {
  const { avatarStatuses, setAvatarStatus } = useAvatarContext();

  // Unique key per avatar
  if (!user) { return null; }

  const key = user.avatar || user.avatarFallback || user.name;
  const avatarStatus = key ? avatarStatuses[key] : null;

  const formattedName = user?.name?.[0]?.toUpperCase() || "?";

  return user?.avatar && (avatarStatus === 'avatar' || !avatarStatus) ? (
    <Img user={user} key={key} setAvatarStatus={setAvatarStatus} />
  ) : (
    <FallbackImg user={user} formattedName={formattedName} textSize={textSize} />
  );
}

const Img = ({ user, setAvatarStatus }: any) => {
  if (!user?.avatar) {
    const key = user.avatar || user.avatarFallback || user.name;
    setAvatarStatus(key, 'fallback');
    return null;
  }

  const key = user.avatar || user.avatarFallback || user.name;

  return (
    <img
      className="rounded-full w-full h-full select-none object-cover aspect-square"
      src={user.avatar.startsWith('http') ? user.avatar : `${backendUrl}/uploads/${user.avatar}`}
      alt="Avatar"
      onError={() => setAvatarStatus(key, 'fallback')}
      onLoad={() => setAvatarStatus(key, 'avatar')}
    />
  );
};

const FallbackImg = ({ user, formattedName, textSize }: any) => {
  return (
    <div
      className={`rounded-full bg-gray-300 text-white flex items-center justify-center w-full h-full select-none ${textSize || 'text-lg'}`}
      style={{ backgroundColor: user?.avatarFallback }}
    >
      {user?.name && user.name !== 'Wachten op speler' ? formattedName : null}
    </div>
  );
};
