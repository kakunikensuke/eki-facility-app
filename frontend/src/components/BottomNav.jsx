import { useLocation, useNavigate } from "react-router-dom";

// 地図表示は要件定義書8.2で将来拡張候補として保留（アプリの核心的な利用シーン＝
// 駅同士の店舗数比較から外れるため、タブごと未設置。2026-07-18判断）。
// 比較タブは2026-07-17、お気に入りタブは2026-07-18実装。
const ITEMS = [
  { key: "home", label: "ホーム", icon: "🏠", path: "/" },
  { key: "compare", label: "比較", icon: "📊", path: "/compare" },
  { key: "favorite", label: "お気に入り", icon: "⭐", path: "/favorites" },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeKey =
    location.pathname === "/compare"
      ? "compare"
      : location.pathname === "/favorites"
        ? "favorite"
        : "home";

  return (
    <nav className="bottom-nav" aria-label="アプリ内ナビゲーション">
      {ITEMS.map((item) => {
        const active = item.key === activeKey;

        return (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-item${active ? " active" : ""}`}
            onClick={() => {
              if (active) return;
              navigate(item.path);
            }}
            title={item.label}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
