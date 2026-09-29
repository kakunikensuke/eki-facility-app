import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchDoc } from "../api";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import { useDocumentMeta } from "../useDocumentTitle";
import NotFound from "./NotFound";

// 路線ページ・記事・その一覧（2026-09-29追加）。
// 本文HTMLは scripts/contentDocs.js がビルド時に作り、静的HTML（prerender.js）と同じ物を
// /api/docs/<kind>/<slug>.json で受け取って差し込む。画面側で文章を組み立てないこと
// （組み立てを2か所に持つと、画面とクローラの見る中身がずれる。CLAUDE.md参照）。
//
// kind: "line" | "article" | "pref" | "index"。index のときは slug を props で受ける（/lines・/articles・/prefectures）
// 種類ごとの一覧ページ（見出しの上の小見出しから戻る先。prerender.js のパンくずも同じ）
const DOC_PARENTS = { line: "/lines", article: "/articles", pref: "/prefectures" };

export default function DocPage({ kind, slug: fixedSlug }) {
  const params = useParams();
  const slug = fixedSlug ?? params.slug;
  const key = `${kind}/${slug}`;
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | not-found | error

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    fetchDoc(key)
      .then((result) => {
        if (!alive) return;
        if (!result) {
          setStatus("not-found");
          return;
        }
        setDoc({ key, ...result });
        setStatus("ok");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [key]);

  const ready = status === "ok" && doc?.key === key;
  useDocumentMeta(ready ? doc.title : undefined, ready ? doc.description : undefined);

  // 本文を読み込んでから #見出し の位置へ移る（トップの「福井県 2駅」→ /prefectures#fukui など）
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    // 本文は後から差し込むので、ブラウザの :target が効かない。印は自分で付ける
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    document.querySelectorAll(".doc .is-target").forEach((x) => x.classList.remove("is-target"));
    el.classList.add("is-target");
    el.scrollIntoView({ block: "center" });
  }, [ready, hash]);

  if (status === "not-found") return <NotFound />;

  // 本文中のサイト内リンクは、ページを読み直さずに画面遷移させる
  function handleClick(event) {
    const anchor = event.target.closest("a");
    if (!anchor || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    event.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  }

  return (
    <div className="page">
      <header className="page-head">
        <Link className="page-head-brand" to="/">
          住みやすさ駅前スコア
        </Link>
        {ready && (
          <>
            <p className="page-head-kicker">
              {kind === "index" ? (
                "特集"
              ) : (
                <Link to={DOC_PARENTS[kind]}>{doc.kicker}</Link>
              )}
            </p>
            <h1 className="page-head-title doc-title">{doc.heading}</h1>
            <p className="page-head-lead">{doc.lead}</p>
          </>
        )}
      </header>

      <main className="page-body">
        {status === "loading" && <p className="status-message">読み込み中...</p>}
        {status === "error" && (
          <p className="status-message status-error">
            データの取得に失敗しました。時間をおいて再度お試しください。
          </p>
        )}
        {ready && (
          // 中身は自前のデータからビルド時に作ったHTML（外部の入力は含まない）
          <article className="doc" onClick={handleClick} dangerouslySetInnerHTML={{ __html: doc.html }} />
        )}
      </main>

      <Footer />
      <BottomNav />
    </div>
  );
}
