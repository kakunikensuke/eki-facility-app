import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { CONTACT_RECEIVED_BLOCKS } from "../content/pages";
import { STATIC_PAGES } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";

const META = STATIC_PAGES.find((p) => p.path === "/contact-received");

// お問い合わせフォームの送信後、FormSubmitから_nextで戻ってくる先。
// 直接開かれることもあるので、React側にもルートを持たせている。
// 本文は content/pages.js のデータ（プリレンダと共有）。
export default function ContactReceivedPage() {
  useDocumentMeta(META.title, META.description);

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">お問い合わせを受け付けました</div>
        </div>
      </header>

      <div className="legal-card">
        <ContentBlocks blocks={CONTACT_RECEIVED_BLOCKS} />
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
