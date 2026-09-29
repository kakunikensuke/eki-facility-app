import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { fetchStations } from "./api";
import TopPage from "./pages/TopPage";
import StationPage from "./pages/StationPage";
import SearchPage from "./pages/SearchPage";
import ComparePage from "./pages/ComparePage";
import FavoritesPage from "./pages/FavoritesPage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import GuidePage from "./pages/GuidePage";
import AboutPage from "./pages/AboutPage";
import ContactPage from "./pages/ContactPage";
import ContactReceivedPage from "./pages/ContactReceivedPage";
import DocPage from "./pages/DocPage";
import NotFound from "./pages/NotFound";
import "./App.css";
import "./design.css";

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
        <Route path="/search" element={<SearchPage />} />
        <Route path="/compare" element={<ComparePage stations={stations} />} />
        <Route path="/favorites" element={<FavoritesPage stations={stations} />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/contact-received" element={<ContactReceivedPage />} />
        {/* 路線ページと記事（2026-09-29追加。本文は scripts/contentDocs.js） */}
        <Route path="/lines" element={<DocPage kind="index" slug="lines" />} />
        <Route path="/line/:slug" element={<DocPage kind="line" />} />
        <Route path="/articles" element={<DocPage kind="index" slug="articles" />} />
        <Route path="/article/:slug" element={<DocPage kind="article" />} />
        {/* 都道府県ページ（2026-09-30追加） */}
        <Route path="/prefectures" element={<DocPage kind="index" slug="prefectures" />} />
        <Route path="/pref/:slug" element={<DocPage kind="pref" />} />
        <Route path="/:stationSlug" element={<StationPage stations={stations} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
