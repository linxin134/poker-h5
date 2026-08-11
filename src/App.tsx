import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AuthModal } from "./components/AuthModal";
import { Lobby } from "./components/Lobby";
import { PokerTable } from "./components/PokerTable";
import { api, type User } from "./services/api";
import { useGameStore } from "./store/gameStore";
import { useRoomStore } from "./store/roomStore";
import { playSound, unlockAudio } from "./services/audio";

export function App() {
  const screen = useGameStore((state) => state.screen);
  const setScreen = useGameStore((state) => state.setScreen);
  const connectRoom = useRoomStore((state) => state.connect);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const sound = useGameStore((state) => state.settings.sound);

  useEffect(() => {
    const syncVisualViewport = () => {
      const viewport = window.visualViewport;
      const visibleHeight = Math.round(viewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty("--app-height", `${visibleHeight}px`);
    };
    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport, { passive: true });
    window.addEventListener("orientationchange", syncVisualViewport, { passive: true });
    window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
    window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });
    return () => {
      window.removeEventListener("resize", syncVisualViewport);
      window.removeEventListener("orientationchange", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  useEffect(() => {
    const unlock = (event: PointerEvent) => {
      unlockAudio();
      if ((event.target as Element | null)?.closest("button")) playSound("click", sound * .55);
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [sound]);

  useEffect(() => {
    void api.me().then(async ({ user: current }) => {
      setUser(current);
      const code = window.sessionStorage.getItem("poker-active-room");
      if (!current || !code) return;
      try {
        await api.room(code);
        connectRoom(code);
        setScreen("table");
      } catch { window.sessionStorage.removeItem("poker-active-room"); }
    }).catch(() => undefined);
  }, [connectRoom, setScreen]);

  function authenticated(next: User) {
    setUser(next);
    setAuthOpen(false);
  }

  return (
    <main className="app-shell mode-mobile">
      {screen === "lobby" ? (
        <Lobby user={user} onLogin={() => setAuthOpen(true)} onLogout={async () => { await api.logout(); setUser(null); }} onUserChange={setUser} />
      ) : (
        <PokerTable user={user} onLogin={() => setAuthOpen(true)} />
      )}
      <AnimatePresence>
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} />}
      </AnimatePresence>
    </main>
  );
}
