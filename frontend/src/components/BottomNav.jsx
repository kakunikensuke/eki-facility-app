import { useLocation, useNavigate } from "react-router-dom";

// アイコンは線だけのSVG（2026-09-29に絵文字から置き換え。絵文字は端末ごとに絵柄が違い、
// 写真を使った新しいデザインの中で浮いていた）
const ICONS = {
  home: <path d="M4 11.5 12 5l8 6.5V20h-5v-5h-6v5H4z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  compare: <path d="M6 20V10M12 20V4M18 20v-7" />,
  favorite: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
};

// 地図表示は要件定義書8.2で将来拡張候補として保留（2026-07-18判断）。
// 比較タブは2026-07-17、お気に入りタブは2026-07-18、条件で探すタブは2026-09-29実装。
const ITEMS = [
  { key: "home", label: "ホーム", path: "/" },
  { key: "search", label: "条件で探す", path: "/search" },
  { key: "compare", label: "比較", path: "/compare" },
  { key: "favorite", label: "お気に入り", path: "/favorites" },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  // 駅ページはホームの配下として扱うので、どのタブにも当たらなければホーム
  const activeKey =
    ITEMS.find((item) => item.path !== "/" && item.path === location.pathname)?.key ?? "home";

  return (
    <nav className="bottom-nav" aria-label="アプリ内ナビゲーション">
      {ITEMS.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-item${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              // 判定にactiveを使わないこと。駅ページもホームを選択中として扱うが、
              // 実際には別URLなので遷移させる必要がある。
              if (location.pathname === item.path) return;
              navigate(item.path);
            }}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[item.key]}
              </svg>
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
