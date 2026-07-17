import { useLocation, useNavigate } from "react-router-dom";

// お気に入り・地図表示は要件定義書8.2の将来拡張候補のまま未実装（準備中表示）。
// 比較タブは2026-07-17実装（/compare へ遷移）。
const ITEMS = [
  { key: "home", label: "ホーム", icon: "🏠", path: "/" },
  { key: "compare", label: "比較", icon: "📊", path: "/compare" },
  { key: "favorite", label: "お気に入り", icon: "⭐", path: null },
  { key: "map", label: "地図", icon: "🗺️", path: null },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isCompare = location.pathname === "/compare";

  return (
    <nav className="bottom-nav" aria-label="アプリ内ナビゲーション">
      {ITEMS.map((item) => {
        const enabled = item.path !== null;
        const active = enabled && (item.key === "compare" ? isCompare : !isCompare);

        return (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-item${active ? " active" : ""}`}
            disabled={!enabled}
            onClick={() => {
              if (!enabled || active) return;
              navigate(item.path);
            }}
            title={enabled ? item.label : `${item.label}（準備中）`}
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
