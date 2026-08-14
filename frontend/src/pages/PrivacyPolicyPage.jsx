import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { PRIVACY_BLOCKS, contactBlocks } from "../content/pages";
import { STATIC_PAGES } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";

const META = STATIC_PAGES.find((p) => p.path === "/privacy");

// 本文は content/pages.js のデータ。プリレンダと共有しているのでここに直書きしないこと。
//
// 以前はここに問い合わせフォームのUIを直書きしていたが、入力欄がすべてdisabledで
// 送信できず、連絡手段が無いのと同じ状態だった。実際に届くフォームのURLが
// 入るまで欄ごと出さない方針にしている（content/pages.js の contactBlocks）。
export default function PrivacyPolicyPage() {
  useDocumentMeta(META.title, META.description);

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">プライバシーポリシー・利用規約</div>
        </div>
      </header>

      <div className="legal-card">
        <ContentBlocks blocks={[...PRIVACY_BLOCKS, ...contactBlocks()]} />
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
