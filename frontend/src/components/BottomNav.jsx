// 将来機能（駅比較・お気に入り・地図表示）のためのプレースホルダー。
// 現時点ではホーム以外は未実装のため無効化しておく。
const ITEMS = [
  { key: "home", label: "ホーム", icon: "🏠", active: true },
  { key: "compare", label: "比較", icon: "📊", active: false },
  { key: "favorite", label: "お気に入り", icon: "⭐", active: false },
  { key: "map", label: "地図", icon: "🗺️", active: false },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="今後追加予定の機能（準備中）">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`bottom-nav-item${item.active ? " active" : ""}`}
          disabled={!item.active}
          title={item.active ? item.label : `${item.label}（準備中）`}
        >
          <span className="bottom-nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="bottom-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
