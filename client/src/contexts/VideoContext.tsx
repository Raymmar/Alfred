import { createContext, useContext, useRef } from 'react';

interface Player {
  play: () => void;
  pause: () => void;
}

type VideoContextType = {
  registerPlayer: (id: string, player: Player) => void;
  unregisterPlayer: (id: string) => void;
  pauseOthers: (currentId: string) => void;
};

const VideoContext = createContext<VideoContextType | null>(null);

export function VideoProvider({ children }: { children: React.ReactNode }) {
  const players = useRef<Map<string, Player>>(new Map());

  const value = {
    registerPlayer: (id: string, player: Player) => {
      players.current.set(id, player);
    },
    unregisterPlayer: (id: string) => {
      players.current.delete(id);
    },
    pauseOthers: (currentId: string) => {
      players.current.forEach((player, id) => {
        if (id !== currentId) {
          player.pause();
        }
      });
    },
  };

  return <VideoContext.Provider value={value}>{children}</VideoContext.Provider>;
}

export function useVideo() {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideo must be used within a VideoProvider');
  }
  return context;
}
