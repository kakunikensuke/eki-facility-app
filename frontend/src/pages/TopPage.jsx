import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStationScores } from "../api";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import { topTitle, topDescription } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";

// ランキングに出す件数。全349駅を順位付きで並べても読まれないため上位だけ出し、
// 残りは下の全駅一覧（＝クローラ向けの内部リンクも兼ねる）に任せる。
const RANKING_LIMIT = 20;

// トップページ。
//
// 2026-08-08まで `/` は1駅目（池袋）へリダイレクトするだけで独自の中身が無かった。
// プリレンダHTMLは全駅へのリンクを持つのに、JSが動いた瞬間に破棄されるため、
// 本来いちばん強くなるはずのトップページが検索上で池袋駅ページに吸収されかねない
// 状態だった（設計書7章参照）。
export default function TopPage({ stations }) {
  const [scores, setScores] = useState(null);
  const [scoreError, setScoreError] = useState(false);
  const [keyword, setKeyword] = useState("");

  useDocumentMeta(topTitle(), topDescription(stations.length));

  useEffect(() => {
    fetchStationScores()
      .then((result) => setScores(result))
      .catch(() => setScoreError(true));
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.trim();
    if (!q) return stations;
    return stations.filter((s) => s.name_ja.includes(q) || s.slug.includes(q.toLowerCase()));
  }, [keyword, stations]);

  const ranking = scores?.stations.slice(0, RANKING_LIMIT) ?? [];

  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="app-logo">住みやすさ駅前スコア</div>
        </div>
        <p className="top-lead">
          駅名を選ぶと、徒歩5〜20分圏内のコンビニ・スーパー・病院・飲食店の軒数がわかります。
          全{stations.length}駅に対応。
        </p>
      </header>

      <div className="top-search">
        <label className="top-search-label" htmlFor="station-search">
          駅を探す
        </label>
        <input
          id="station-search"
          type="search"
          className="top-search-input"
          placeholder="駅名で絞り込む（例: 新宿）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {/* 検索中はランキングを挟むと目的の駅が探しにくいので一覧だけ出す */}
      {!keyword.trim() && ranking.length > 0 && (
        <section className="top-section">
          <h2 className="top-section-title">
            駅前スコアの高い駅 TOP{ranking.length}（徒歩{scores.walk_minutes}分圏内）
          </h2>
          <ol className="ranking-list">
            {ranking.map((s, index) => (
              <li className="ranking-row" key={s.slug}>
                <span className="ranking-rank">{index + 1}</span>
                <Link className="ranking-link" to={`/${s.slug}`}>
                  {s.name_ja}
                </Link>
                {/* スコアは100点で頭打ちになり同点が多く出るため、順位の根拠が
                    見えるように合計軒数も併記する（backend/stationScores.js参照） */}
                <span className="ranking-score">
                  {s.score}点
                  <span className="ranking-count">合計{s.total_count}軒</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {scoreError && !keyword.trim() && (
        <p className="status-message">スコア一覧を取得できませんでした。駅一覧からお選びください。</p>
      )}

      <section className="top-section">
        <h2 className="top-section-title">
          {keyword.trim() ? `「${keyword.trim()}」の検索結果` : `対応駅一覧（${stations.length}駅）`}
        </h2>
        {filtered.length === 0 ? (
          <p className="status-message">該当する駅が見つかりませんでした。</p>
        ) : (
          <div className="station-index">
            {filtered.map((s) => (
              <Link className="station-index-link" key={s.slug} to={`/${s.slug}`}>
                {s.name_ja}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* AdSlotは意図的に置いていない。現状は「広告枠（準備中）」と出るだけのダミーで、
          AdSense審査中にトップページの第一印象がそれになるのは損。承認後に追加する */}

      <Footer />
      <BottomNav />
    </div>
  );
}
