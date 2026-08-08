import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { fetchStations } from "./api";
import TopPage from "./pages/TopPage";
import StationPage from "./pages/StationPage";
import ComparePage from "./pages/ComparePage";
import FavoritesPage from "./pages/FavoritesPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import GuidePage from "./pages/GuidePage";
import NotFound from "./pages/NotFound";
import "./App.css";

function App() {
  const [stations, setStations] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStations()
      .then(setStations)
      .catch(() => setError("駅一覧の取得に失敗しました"));
  }, []);

  if (error) {
    return <p className="status-message status-error">{error}</p>;
  }

  if (!stations) {
    return <p className="status-message">読み込み中...</p>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* 以前はここで1駅目へリダイレクトしていた。トップページが独自の中身を
            持たないと検索上そのまま駅ページに吸収されるため、実体を持たせた
            （設計書7章・pages/TopPage.jsx参照） */}
        <Route path="/" element={<TopPage stations={stations} />} />
        <Route path="/compare" element={<ComparePage stations={stations} />} />
        <Route path="/favorites" element={<FavoritesPage stations={stations} />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/:stationSlug" element={<StationPage stations={stations} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
