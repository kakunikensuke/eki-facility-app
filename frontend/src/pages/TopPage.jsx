import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStationMatrix } from "../api";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import { topTitle, topDescription } from "../pageMeta";
import {
  PRESETS,
  buildTierTable,
  groupByPrefecture,
  matchStationName,
  presetWeights,
  resultReasons,
  searchStations,
} from "../stationSearch";
import { useDocumentMeta } from "../useDocumentTitle";

// 目的別に出す件数。プリレンダ（scripts/prerender.js の PURPOSE_LIMIT）と揃える規約
const PURPOSE_LIMIT = 5;
// 駅名で絞り込んだときに出す上限。1文字目で数百駅並ぶのを避ける
const NAME_MATCH_LIMIT = 40;

// トップページ。
//
// 2026-08-08まで `/` は1駅目（池袋）へリダイレクトするだけで独自の中身が無かった
// （設計書7章参照）。その後「スコア上位20駅＋全349駅のボタンの壁」にしたが、
// 上位は39駅が100点で並んで順位の意味が薄く、駅名を知らない人の入口も無かった。
// 2026-09-29、目的別の上位駅（stationSearch.js）と都道府県別の駅一覧に作り直した。
// 静的HTMLは scripts/prerender.js の topPage が同じ計算から組む。
export default function TopPage({ stations }) {
  const [matrix, setMatrix] = useState(null);
  const [matrixError, setMatrixError] = useState(false);
  const [keyword, setKeyword] = useState("");

  useDocumentMeta(topTitle(), topDescription(stations.length));

  useEffect(() => {
    fetchStationMatrix()
      .then(setMatrix)
      .catch(() => setMatrixError(true));
  }, []);

  const table = useMemo(
    () => (matrix ? buildTierTable(matrix, matrix.default_walk_minutes) : null),
    [matrix]
  );
  const purposes = useMemo(
    () =>
      table
        ? PRESETS.map((preset) => {
            const weights = presetWeights(preset.key);
            const { results } = searchStations(table, { weights });
            return { preset, weights, rows: results.slice(0, PURPOSE_LIMIT) };
          })
        : [],
    [table]
  );

  const groups = useMemo(() => groupByPrefecture(stations), [stations]);
  const q = keyword.trim();
  const nameMatches = useMemo(
    () => (q ? stations.filter((s) => matchStationName(s, q)) : []),
    [q, stations]
  );

  return (
    <div className="app-container app-container-wide">
      <header className="hero-header subpage-header top-hero">
        <h1 className="top-title">住みやすさ駅前スコア</h1>
        <p className="top-lead">
          引っ越し先の駅を、歩いて行ける店の数で比べられます。全国{stations.length}
          駅の徒歩5〜20分圏内にあるコンビニ・スーパー・病院・飲食店・ドラッグストア・公園・保育園/幼稚園を、OpenStreetMapのデータで数えています。
        </p>
      </header>

      <section className="top-section">
        <label className="top-section-title" htmlFor="station-search">
          駅名で探す
        </label>
        <input
          id="station-search"
          type="search"
          className="top-search-input"
          placeholder="駅名・よみがなで絞り込む（例: 新宿、しぶや）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {q && (
          <div className="name-matches" aria-live="polite">
            {nameMatches.length === 0 ? (
              <p className="status-message">該当する駅が見つかりませんでした。</p>
            ) : (
              <div className="station-index">
                {nameMatches.slice(0, NAME_MATCH_LIMIT).map((s) => (
                  <Link className="station-index-link" key={s.slug} to={`/${s.slug}`}>
                    {s.name_ja}
                    <span className="station-index-pref">{s.prefecture}</span>
                  </Link>
                ))}
              </div>
            )}
            {nameMatches.length > NAME_MATCH_LIMIT && (
              <p className="top-note">
                ほかに{nameMatches.length - NAME_MATCH_LIMIT}駅あります。もう少し詳しく入力してください。
              </p>
            )}
          </div>
        )}
      </section>

      <section className="top-section">
        <h2 className="top-section-title">目的から探す</h2>
        <p className="top-note">
          駅名が決まっていなければ、暮らし方から選べます。徒歩10分圏内で、目的に合う項目が全国の上位にそろっている駅の上位{PURPOSE_LIMIT}駅です。
          最低軒数や都道府県を足して絞り込むこともできます。
        </p>
        {matrixError && (
          <p className="status-message">目的別の一覧を取得できませんでした。下の駅一覧からお選びください。</p>
        )}
        {!matrixError && !table && <p className="status-message">読み込み中...</p>}
        {table && (
          <div className="purpose-grid">
            {purposes.map(({ preset, weights, rows }) => (
              <article className="purpose-card" key={preset.key}>
                <h3 className="purpose-title">{preset.label}</h3>
                <p className="purpose-lead">{preset.lead}</p>
                <ol className="purpose-list">
                  {rows.map((row) => (
                    <li key={row.station.slug}>
                      <Link className="purpose-station" to={`/${row.station.slug}`}>
                        {row.station.name_ja}
                      </Link>
                      <span className="purpose-reason">
                        {resultReasons(table, row, weights, 2)
                          .map((r) => `${r.label}${r.count}軒`)
                          .join("・")}
                      </span>
                    </li>
                  ))}
                </ol>
                <Link className="purpose-more" to={`/search?preset=${preset.key}`}>
                  {preset.label}の条件で絞り込む
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="top-section">
        <h2 className="top-section-title">都道府県から探す（{stations.length}駅）</h2>
        <p className="top-note">各都道府県の中は五十音順です。</p>
        <div className="pref-groups">
          {groups.map((g) => (
            <details className="pref-group" key={g.prefecture}>
              <summary>
                {g.prefecture}
                <span className="pref-group-count">{g.stations.length}駅</span>
              </summary>
              <div className="station-index">
                {g.stations.map((s) => (
                  <Link className="station-index-link" key={s.slug} to={`/${s.slug}`}>
                    {s.name_ja}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* AdSlotは意図的に置いていない。現状は「広告枠（準備中）」と出るだけのダミーで、
          AdSense審査中にトップページの第一印象がそれになるのは損。承認後に追加する */}

      <Footer />
      <BottomNav />
    </div>
  );
}
