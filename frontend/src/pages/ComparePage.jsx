import { useEffect, useState } from "react";
import { fetchFacilityCounts } from "../api";
import { CATEGORIES, EXTRA_CATEGORIES } from "../categories";
import BottomNav from "../components/BottomNav";

// 引越し検討者が「今の駅 or 候補駅同士」を比べる、というアプリの核心的な利用シーン
// (project_eki_facility_app.md参照)を2駅固定・毎回選び直す方式で実現する。

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
  const [slugA, setSlugA] = useState(stations[0]?.slug ?? "");
  const [slugB, setSlugB] = useState(stations[1]?.slug ?? "");

  const { data: dataA, status: statusA } = useStationData(slugA);
  const { data: dataB, status: statusB } = useStationData(slugB);

  const nameOf = (slug) => stations.find((s) => s.slug === slug)?.name_ja ?? "";
  const sameStation = Boolean(slugA) && slugA === slugB;
  const bothReady = !sameStation && statusA === "ok" && statusB === "ok" && dataA && dataB;

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
                dataA.score.total >= dataB.score.total ? " compare-score-winner" : ""
              }`}
            >
              <div className="compare-score-name">{nameOf(slugA)}</div>
              <div className="compare-score-value">{dataA.score.total}</div>
              <div className="compare-score-label">SCORE</div>
            </div>
            <div className="compare-score-divider" />
            <div
              className={`compare-score-item${
                dataB.score.total >= dataA.score.total ? " compare-score-winner" : ""
              }`}
            >
              <div className="compare-score-name">{nameOf(slugB)}</div>
              <div className="compare-score-value">{dataB.score.total}</div>
              <div className="compare-score-label">SCORE</div>
            </div>
          </div>

          <div className="compare-card">
            <div className="compare-card-title">カテゴリ別 軒数比較</div>
            {[...CATEGORIES, ...EXTRA_CATEGORIES].map((cat) => {
              const countA = dataA.counts[cat.key] || 0;
              const countB = dataB.counts[cat.key] || 0;
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

      <BottomNav />
    </div>
  );
}
