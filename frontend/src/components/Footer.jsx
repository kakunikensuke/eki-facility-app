import { Link, useLocation } from "react-router-dom";
import { SITE_NAME, STATIC_PAGES } from "../pageMeta";

// 全ページ共通のフッター。
//
// リンクを直書きせず STATIC_PAGES から組むこと。プリレンダ側（scripts/prerender.js の
// siteFooterHtml）が同じ定義から静的HTMLのフッターを作っており、片方だけ書き換えると
// 「画面には出ているのにクローラには見えないリンク」が生まれる。
// 実際それが原因でAdSenseに2回落ちている（駅ページの静的HTMLに運営者情報・
// プライバシーポリシーへのリンクが1本も無かった。2026-08-29修正）。
export default function Footer() {
  const { pathname } = useLocation();
  const items = [
    { path: "/", label: "駅一覧" },
    ...STATIC_PAGES.filter((p) => !p.hideFromNav).map((p) => ({
      path: p.path,
      label: p.heading,
    })),
  ].filter((item) => item.path !== pathname);

  return (
    <footer className="app-footer">
      <nav className="app-footer-links" aria-label="サイト内リンク">
        {items.map((item) => (
          <Link key={item.path} to={item.path}>
            {item.label}
          </Link>
        ))}
      </nav>
      {/* ODbLライセンスの要求により全ページに出典表示が必要（CLAUDE.md参照） */}
      <p className="app-footer-note">
        店舗数の集計には{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>{" "}
        のデータを利用しています（地図データ: © OpenStreetMap contributors／ODbLライセンス）。
      </p>
      <p className="app-footer-note">{SITE_NAME} — 運営: kakuni-lab</p>
    </footer>
  );
}
