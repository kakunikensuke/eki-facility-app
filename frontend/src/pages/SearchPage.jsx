import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchStationMatrix } from "../api";
import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { SEARCH_BLOCKS } from "../content/pages";
import { STATIC_PAGES } from "../pageMeta";
import {
  PRESETS,
  SEARCH_CATEGORIES,
  WEIGHT_LEVELS,
  buildTierTable,
  condFromParams,
  groupByPrefecture,
  matchPreset,
  paramsFromCond,
  presetWeights,
  resultReasons,
  searchStations,
  thresholdOptions,
} from "../stationSearch";
import { useDocumentMeta } from "../useDocumentTitle";

const META = STATIC_PAGES.find((p) => p.path === "/search");

// 一度に出す件数。349駅を全部並べても読まれないので、続きはボタンで出す
const PAGE_SIZE = 30;

const labelOf = (key) => SEARCH_CATEGORIES.find((c) => c.key === key)?.label ?? key;

// 条件で駅を探すページ（2026-09-29追加）。計算は stationSearch.js、
// 静的HTMLの中身（初期状態の結果と解説）は scripts/prerender.js が同じ計算から組む。
// 条件はすべてURLのクエリに持たせる（ブックマーク・共有・戻るボタンで条件が消えないように）。
export default function SearchPage() {
  useDocumentMeta(META.title, META.description);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState(false);
  const [params, setParams] = useSearchParams();
  const [shown, setShown] = useState(PAGE_SIZE);

  useEffect(() => {
    fetchStationMatrix()
      .then(setMatrix)
      .catch(() => setError(true));
  }, []);

  const cond = useMemo(() => (matrix ? condFromParams(params, matrix) : null), [params, matrix]);
  const table = useMemo(
    () => (matrix && cond ? buildTierTable(matrix, cond.walkMinutes) : null),
    [matrix, cond]
  );
  const outcome = useMemo(() => (table ? searchStations(table, cond) : null), [table, cond]);
  const prefectures = useMemo(() => (matrix ? groupByPrefecture(matrix.stations) : []), [matrix]);

  // 条件が変わったら表示件数を戻す
  const paramKey = params.toString();
  useEffect(() => setShown(PAGE_SIZE), [paramKey]);

  function update(next) {
    setParams(paramsFromCond({ ...cond, ...next }, matrix.default_walk_minutes), { replace: true });
  }

  const presetKey = cond ? matchPreset(cond.weights) : null;
  const preset = PRESETS.find((p) => p.key === presetKey);
  const activeMinCount = cond ? Object.values(cond.mins).filter(Boolean).length : 0;

  return (
    <div className="app-container app-container-wide">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <h1 className="page-title">条件で駅を探す</h1>
        </div>
      </header>

      <p className="search-lead">
        駅名が決まっていなくても大丈夫です。暮らしに必要な店の条件から、全国の対応駅を絞り込んで並べます。
      </p>

      {error && (
        <p className="status-message status-error">
          駅データを取得できませんでした。時間をおいて再度お試しください。
        </p>
      )}
      {!error && !outcome && <p className="status-message">読み込み中...</p>}

      {outcome && (
        <div className="search-layout">
          <section className="search-panel" aria-label="検索条件">
            <div className="search-field-label">何を重視しますか</div>
            <div className="preset-buttons" role="group" aria-label="目的">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="preset-button"
                  aria-pressed={p.key === presetKey}
                  onClick={() => update({ weights: presetWeights(p.key) })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="preset-lead">
              {preset ? preset.lead : "項目ごとの重視度を自分で調整しています"}
            </p>

            <div className="search-field-label">駅からの距離</div>
            <div className="walk-tabs walk-tabs-inline" role="group" aria-label="集計範囲（徒歩分数）">
              {matrix.walk_minutes.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={minutes === cond.walkMinutes}
                  className={`walk-tab${minutes === cond.walkMinutes ? " walk-tab-active" : ""}`}
                  onClick={() => update({ walkMinutes: minutes })}
                >
                  徒歩{minutes}分
                </button>
              ))}
            </div>

            <label className="search-field-label" htmlFor="search-pref">
              都道府県
            </label>
            <select
              id="search-pref"
              className="search-select"
              value={cond.pref}
              onChange={(e) => update({ pref: e.target.value })}
            >
              <option value="">すべて（{matrix.stations.length}駅）</option>
              {prefectures.map((g) => (
                <option key={g.prefecture} value={g.prefecture}>
                  {g.prefecture}（{g.stations.length}駅）
                </option>
              ))}
            </select>

            <details className="search-detail" open={activeMinCount > 0 || !preset || undefined}>
              <summary>
                項目ごとの条件（最低軒数・重視度）
                {activeMinCount > 0 && <span className="search-detail-badge">{activeMinCount}件指定中</span>}
              </summary>
              <p className="search-detail-note">
                最低軒数の選択肢は、徒歩{cond.walkMinutes}分圏内の全国の分布から出しています。
                かっこ内は、その条件を満たす駅が全国に何%あるかです。
              </p>
              <table className="cond-table">
                <thead>
                  <tr>
                    <th scope="col">項目</th>
                    <th scope="col">最低軒数</th>
                    <th scope="col">重視度</th>
                  </tr>
                </thead>
                <tbody>
                  {SEARCH_CATEGORIES.map((c) => {
                    const options = thresholdOptions(table, c.key);
                    const current = cond.mins[c.key] ?? 0;
                    // 徒歩分数を変えると選択肢の軒数も変わる。選んだ値が消えないよう残す
                    if (current && !options.some((o) => o.value === current)) {
                      options.push({ value: current, share: null });
                      options.sort((a, b) => a.value - b.value);
                    }
                    return (
                      <tr key={c.key}>
                        <th scope="row">
                          <span className={`cat-dot cat-dot-${c.key}`} aria-hidden="true" />
                          {c.label}
                        </th>
                        <td>
                          <select
                            aria-label={`${c.label}の最低軒数`}
                            value={current}
                            onChange={(e) =>
                              update({ mins: { ...cond.mins, [c.key]: Number(e.target.value) } })
                            }
                          >
                            <option value={0}>指定なし</option>
                            {options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.value}軒以上{o.share ? `（${o.share}%）` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            aria-label={`${c.label}の重視度`}
                            value={cond.weights[c.key] ?? 0}
                            onChange={(e) =>
                              update({ weights: { ...cond.weights, [c.key]: Number(e.target.value) } })
                            }
                          >
                            {WEIGHT_LEVELS.map((w) => (
                              <option key={w.value} value={w.value}>
                                {w.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>

            {paramKey && (
              <button type="button" className="search-reset" onClick={() => setParams({}, { replace: true })}>
                条件をすべて戻す
              </button>
            )}
          </section>

          <section className="search-results" aria-live="polite">
            <h2 className="search-results-title">
              {cond.pref || "全国"}で条件に合う駅：{outcome.results.length}駅
              <span className="search-results-total">（全{outcome.total}駅中）</span>
            </h2>
            <p className="search-results-note">
              並び順：{preset ? preset.label : "自分で調整した重視度"}・徒歩{cond.walkMinutes}
              分圏内。右の数字は適合度（選んだ項目が全国のどの位置にあるかの重み付き平均、0〜100）です。
            </p>

            {outcome.results.length === 0 && (
              <div className="search-empty">
                <p>条件に合う駅がありませんでした。</p>
                {outcome.relax.length > 0 && (
                  <>
                    <p>次の条件を外すと見つかります。</p>
                    <div className="relax-buttons">
                      {outcome.relax.map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          className="relax-button"
                          onClick={() =>
                            r.key === "pref"
                              ? update({ pref: "" })
                              : update({ mins: { ...cond.mins, [r.key]: 0 } })
                          }
                        >
                          {r.key === "pref" ? `都道府県（${cond.pref}）` : `${labelOf(r.key)}の最低軒数`}
                          を外す → {r.count}駅
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {outcome.results.length > 0 && (
              <ol className="result-list">
                {outcome.results.slice(0, shown).map((row, i) => (
                  <li className="result-row" key={row.station.slug}>
                    <span className="result-rank">{i + 1}</span>
                    <div className="result-main">
                      <div className="result-head">
                        <Link className="result-name" to={`/${row.station.slug}`}>
                          {row.station.name_ja}
                        </Link>
                        <span className="result-pref">{row.station.prefecture}</span>
                      </div>
                      <div className="result-reasons">
                        {resultReasons(table, row, outcome.weights).map((r) => (
                          <span className="result-reason" key={r.key}>
                            <span className={`cat-dot cat-dot-${r.key}`} aria-hidden="true" />
                            {r.label} {r.count}軒
                            <span className="result-share">上位{r.share}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="result-fit" aria-label={`適合度${row.fit}`}>
                      {row.fit}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {outcome.results.length > shown && (
              <button
                type="button"
                className="result-more"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
              >
                続きを表示（残り{outcome.results.length - shown}駅）
              </button>
            )}
          </section>
        </div>
      )}

      <div className="legal-card">
        <ContentBlocks blocks={SEARCH_BLOCKS} />
      </div>

      <Footer />
      <BottomNav />
    </div>
  );
}
