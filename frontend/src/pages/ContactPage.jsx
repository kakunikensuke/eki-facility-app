import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { CONTACT_BLOCKS } from "../content/pages";
import { STATIC_PAGES } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";

const META = STATIC_PAGES.find((p) => p.path === "/contact");

// お問い合わせ。
//
// 独立したページにしている理由: 以前はフォームを運営者情報とプライバシーポリシーの
// 末尾に埋め込むだけで「お問い合わせページ」が存在しなかった。同じフォームが複数
// ページに重複するうえ、審査ボットやクローラから問い合わせ手段を見つけられず、
// AdSenseの審査で不利になっていた（2026-08-29に分離）。
//
// 本文は content/pages.js のデータ（プリレンダと共有）。
export default function ContactPage() {
  useDocumentMeta(META.title, META.description);

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">お問い合わせ</div>
        </div>
      </header>

      <div className="legal-card">
        <ContentBlocks blocks={CONTACT_BLOCKS} />
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
