import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { AuthModal } from "./components/AuthModal";
import { Lobby } from "./components/Lobby";
import { PokerTable } from "./components/PokerTable";
import { api, type User } from "./services/api";
import { useGameStore } from "./store/gameStore";
import { useRoomStore } from "./store/roomStore";

export function App() {
  const screen = useGameStore((state) => state.screen);
  const setScreen = useGameStore((state) => state.setScreen);
  const connectRoom = useRoomStore((state) => state.connect);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

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
    <main className="app-shell">
      {screen === "lobby" ? (
        <Lobby user={user} onLogin={() => setAuthOpen(true)} onLogout={async () => { await api.logout(); setUser(null); }} />
      ) : (
        <PokerTable user={user} onLogin={() => setAuthOpen(true)} />
      )}
      <AnimatePresence>
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} />}
      </AnimatePresence>
    </main>
  );
}
