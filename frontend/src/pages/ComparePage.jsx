import { useEffect, useState } from "react";
import { fetchFacilityCounts } from "../api";
import { CATEGORIES, EXTRA_CATEGORIES } from "../categories";
import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { COMPARE_BLOCKS } from "../content/pages";
import { STATIC_PAGES } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";
import { DEFAULT_WALK_MINUTES } from "../walkTiers";

const META = STATIC_PAGES.find((p) => p.path === "/compare");

// 引越し検討者が「今の駅 or 候補駅同士」を比べる、というアプリの核心的な利用シーン
// (project_eki_facility_app.md参照)を2駅固定・毎回選び直す方式で実現する。
//
// 比較は徒歩10分圏に固定している。駅ページ側は4段階を切り替えられる(2026-08-07追加)が、
// ここで段階も可変にすると「どの範囲で比べているか」が分かりにくくなるため、
// 既定の段階だけを扱う。

// 集計途中の駅は既定の段階を持たないことがあるため、無ければ利用可能な最小の段階で代替する
function pickTier(data) {
  return data?.tiers?.[DEFAULT_WALK_MINUTES] ?? data?.tiers?.[data?.available_walk_minutes?.[0]];
}

function useCompareMeta() {
  // これが無いと、他ページから遷移してきたときにtitleが前のページのまま残る
  useDocumentMeta(META.title, META.description);
}

function useStationData(slug) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(slug ? "loading" : "idle");

  useEffect(() => {
    if (!slug) {
      setData(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    fetchFacilityCounts(slug)
      .then((result) => {
        if (result === null) {
          setStatus("not-found");
          return;
        }
        setData(result);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [slug]);

  return { data, status };
}

export default function ComparePage({ stations }) {
  useCompareMeta();
  const [slugA, setSlugA] = useState(stations[0]?.slug ?? "");
  const [slugB, setSlugB] = useState(stations[1]?.slug ?? "");

  const { data: dataA, status: statusA } = useStationData(slugA);
  const { data: dataB, status: statusB } = useStationData(slugB);

  const nameOf = (slug) => stations.find((s) => s.slug === slug)?.name_ja ?? "";
  const sameStation = Boolean(slugA) && slugA === slugB;
  const tierA = pickTier(dataA);
  const tierB = pickTier(dataB);
  const bothReady = !sameStation && statusA === "ok" && statusB === "ok" && tierA && tierB;

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">駅を比較</div>
        </div>
      </header>

      <div className="compare-select-row">
        <select
          className="compare-select-input"
          aria-label="駅A"
          value={slugA}
          onChange={(e) => setSlugA(e.target.value)}
        >
          <option value="">選択してください</option>
          {stations.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name_ja}
            </option>
          ))}
        </select>
        <select
          className="compare-select-input"
          aria-label="駅B"
          value={slugB}
          onChange={(e) => setSlugB(e.target.value)}
        >
          <option value="">選択してください</option>
          {stations.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name_ja}
            </option>
          ))}
        </select>
      </div>

      {sameStation && <p className="status-message">異なる2駅を選んでください。</p>}

      {!sameStation && (statusA === "loading" || statusB === "loading") && (
        <p className="status-message">読み込み中...</p>
      )}
      {!sameStation && (statusA === "error" || statusB === "error") && (
        <p className="status-message status-error">
          データの取得に失敗しました。時間をおいて再度お試しください。
        </p>
      )}
      {!sameStation && (statusA === "not-found" || statusB === "not-found") && (
        <p className="status-message">選択した駅の集計データはまだ準備できていません。</p>
      )}

      {bothReady && (
        <>
          <div className="compare-score-card">
            <div
              className={`compare-score-item${
                tierA.score.total >= tierB.score.total ? " compare-score-winner" : ""
              }`}
            >
              <div className="compare-score-name">{nameOf(slugA)}</div>
              <div className="compare-score-value">{tierA.score.total}</div>
              <div className="compare-score-label">SCORE</div>
            </div>
            <div className="compare-score-divider" />
            <div
              className={`compare-score-item${
                tierB.score.total >= tierA.score.total ? " compare-score-winner" : ""
              }`}
            >
              <div className="compare-score-name">{nameOf(slugB)}</div>
              <div className="compare-score-value">{tierB.score.total}</div>
              <div className="compare-score-label">SCORE</div>
            </div>
          </div>

          <div className="compare-card">
            <div className="compare-card-title">
              カテゴリ別 軒数比較（徒歩{tierA.walk_minutes}分圏内）
            </div>
            {[...CATEGORIES, ...EXTRA_CATEGORIES].map((cat) => {
              const countA = tierA.counts[cat.key] || 0;
              const countB = tierB.counts[cat.key] || 0;
              return (
                <div className="compare-row" key={cat.key}>
                  <span
                    className={`compare-value${countA > countB ? " compare-value-lead" : ""}`}
                  >
                    {countA}軒
                  </span>
                  <span className="compare-label">
                    {cat.icon} {cat.label}
                  </span>
                  <span
                    className={`compare-value${countB > countA ? " compare-value-lead" : ""}`}
                  >
                    {countB}軒
                  </span>
                </div>
              );
            })}
          </div>

          <div className="info-card">
            <p className="disclaimer">
              店舗数・スコアはOpenStreetMapのデータに基づく目安です。実際の店舗数と異なる場合があります。
            </p>
            <p className="attribution">
              地図データ: ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap contributors
              </a>
            </p>
          </div>
        </>
      )}

      {/* 本文は content/pages.js（プリレンダと共有）。ツール部分は動的なので
          静的HTMLに出せるのはこの解説だけになる */}
      <div className="legal-card">
        <ContentBlocks blocks={COMPARE_BLOCKS} />
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
