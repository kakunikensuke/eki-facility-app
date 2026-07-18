import { Link } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import { toggleFavorite, useFavorites } from "../favorites";

export default function FavoritesPage({ stations }) {
  const favoriteSlugs = useFavorites();
  const favoriteStations = favoriteSlugs
    .map((slug) => stations.find((s) => s.slug === slug))
    .filter(Boolean);

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">お気に入り駅</div>
        </div>
      </header>

      {favoriteStations.length === 0 && (
        <p className="status-message">
          お気に入り駅はまだ登録されていません。駅ページの☆をタップすると追加できます。
        </p>
      )}

      {favoriteStations.length > 0 && (
        <div className="favorites-card">
          {favoriteStations.map((s) => (
            <div className="favorites-row" key={s.slug}>
              <Link to={`/${s.slug}`} className="favorites-link">
                {s.name_ja}
              </Link>
              <button
                type="button"
                className="favorite-toggle"
                aria-label="お気に入りから削除"
                onClick={() => toggleFavorite(s.slug)}
              >
                ★
              </button>
            </div>
          ))}
        </div>
      )}

      <Footer />
      <BottomNav />
    </div>
  );
}
