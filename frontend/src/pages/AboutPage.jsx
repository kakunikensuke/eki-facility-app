import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { ABOUT_BLOCKS, contactBlocks } from "../content/pages";
import { STATIC_PAGES } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";

const META = STATIC_PAGES.find((p) => p.path === "/about");

// 運営者情報。誰が何のために作り、スコアに何ができて何ができないかを明示する。
// 本文は content/pages.js のデータ（プリレンダと共有）。
export default function AboutPage() {
  useDocumentMeta(META.title, META.description);

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">運営者情報</div>
        </div>
      </header>

      <div className="legal-card">
        <ContentBlocks blocks={[...ABOUT_BLOCKS, ...contactBlocks()]} />
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
