import { useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { MultiplayerMenuPage } from "./pages/MultiplayerMenuPage";
import { CreateRoomPage } from "./pages/CreateRoomPage";
import { JoinRoomPage } from "./pages/JoinRoomPage";
import { GamePage } from "./pages/GamePage";

export default function App() {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <>
      {toast && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="rounded-lg bg-slate-800 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-white/10">
            {toast}
          </div>
        </div>
      )}
      <Routes>
        <Route path="/" element={<HomePage onBot={() => showToast("Funzionalità in arrivo")} />} />
        <Route path="/multiplayer" element={<MultiplayerMenuPage />} />
        <Route path="/multiplayer/create" element={<CreateRoomPage />} />
        <Route path="/multiplayer/join" element={<JoinRoomPage />} />
        <Route path="/play/:roomId" element={<GamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
