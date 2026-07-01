import { createContext, useContext, useState, ReactNode } from "react";

type AvatarStatus = 'avatar' | 'fallback';

interface AvatarContextType {
  avatarStatuses: Record<string, AvatarStatus>;
  setAvatarStatus: (key: string, status: AvatarStatus) => void;
}

const AvatarContext = createContext<AvatarContextType | null>(null);

export const AvatarProvider = ({ children }: { children: ReactNode }) => {
  const [avatarStatuses, setAvatarStatuses] = useState<Record<string, AvatarStatus>>({});

  const setAvatarStatus = (key: string, status: AvatarStatus) => {
    setAvatarStatuses(prev => ({ ...prev, [key]: status }));
  };

  return (
    <AvatarContext.Provider value={{ avatarStatuses, setAvatarStatus }}>
      {children}
    </AvatarContext.Provider>
  );
};

export const useAvatarContext = () => {
  const ctx = useContext(AvatarContext);
  if (!ctx) throw new Error("useAvatarContext must be used within AvatarProvider");
  return ctx;
};
