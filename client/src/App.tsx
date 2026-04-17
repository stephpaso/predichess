import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { MultiplayerMenuPage } from "./pages/MultiplayerMenuPage";
import { CreateRoomPage } from "./pages/CreateRoomPage";
import { JoinRoomPage } from "./pages/JoinRoomPage";
import { GamePage } from "./pages/GamePage";
import { BotSetupPage } from "./pages/BotSetupPage";

function PlayToRoomRedirect() {
  const { roomId = "" } = useParams();
  return <Navigate to={`/room/${encodeURIComponent(roomId)}`} replace />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/bot" element={<BotSetupPage />} />
        <Route path="/multiplayer" element={<MultiplayerMenuPage />} />
        <Route path="/multiplayer/create" element={<CreateRoomPage />} />
        <Route path="/multiplayer/join" element={<JoinRoomPage />} />
        <Route path="/room/:roomId" element={<GamePage />} />
        <Route path="/play/:roomId" element={<PlayToRoomRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
