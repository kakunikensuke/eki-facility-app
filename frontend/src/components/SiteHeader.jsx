import { Link } from "react-router-dom";
import { SITE_NAME } from "../pageMeta";

// 写真の上に重ねる細いヘッダー（2026-09-29追加）。トップと駅ページで使う。
// ナビゲーションの本体はボトムナビ（スマホ）／上端の横並びナビ（PC）なので、
// ここはサイト名と「条件で探す」への入口だけを置く。
export default function SiteHeader() {
  return (
    <header className="site-bar">
      <Link className="site-bar-brand" to="/">
        <span className="site-bar-mark" aria-hidden="true" />
        {SITE_NAME}
      </Link>
      <Link className="site-bar-link" to="/search">
        条件で探す
      </Link>
    </header>
  );
}
