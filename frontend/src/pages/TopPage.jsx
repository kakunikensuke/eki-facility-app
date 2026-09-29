import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchDocNav, fetchPhotosLite, fetchStationMatrix } from "../api";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import PhotoHero from "../components/PhotoHero";
import SiteHeader from "../components/SiteHeader";
import { DOMAINS, MAX_TOTAL } from "../livabilityDefs";
import { topTitle, topDescription } from "../pageMeta";
import {
  PRESETS,
  buildTierTable,
  matchStationName,
  presetWeights,
  resultReasons,
  searchStations,
} from "../stationSearch";
import { useDocumentMeta } from "../useDocumentTitle";

// 目的別・総合ランキングに出す件数。プリレンダ（scripts/prerender.js）と揃える規約
const PURPOSE_LIMIT = 5;
const RANKING_LIMIT = 10;
// 駅名で絞り込んだときに出す上限
const NAME_MATCH_LIMIT = 8;
// トップページに出す路線の数（駅の多い順）。残りは /lines から
const TOP_LINES_LIMIT = 24;
// 何も入力していないときの背景に回す駅の数（乗降客数の多い、写真のある駅から）
const FEATURED_COUNT = 8;

// トップページ（2026-09-29に作り直し）。
// 背景は駅の写真が切り替わる。駅名を入力すると、候補の1駅目の写真に背景が切り替わる。
// 静的HTMLは scripts/prerender.js の topPage が同じ計算から組む。
export default function TopPage({ stations }) {
  const navigate = useNavigate();
  const [matrix, setMatrix] = useState(null);
  const [photos, setPhotos] = useState(null);
  const [keyword, setKeyword] = useState("");
  const [docNav, setDocNav] = useState(null);

  useDocumentMeta(topTitle(), topDescription(stations.length));

  useEffect(() => {
    fetchStationMatrix().then(setMatrix).catch(() => setMatrix(false));
    fetchPhotosLite().then(setPhotos).catch(() => setPhotos({}));
    fetchDocNav().then(setDocNav).catch(() => setDocNav(null));
  }, []);

  const table = useMemo(
    () => (matrix ? buildTierTable(matrix, matrix.default_walk_minutes) : null),
    [matrix]
  );

  const q = keyword.trim();
  const matches = useMemo(
    () => (q ? stations.filter((s) => matchStationName(s, q)).slice(0, NAME_MATCH_LIMIT) : []),
    [q, stations]
  );

  // 背景の写真。入力中は候補の先頭の駅、それ以外は大きな駅を1枚ずつ巡回する
  const featured = useMemo(() => {
    if (!photos || !matrix) return [];
    return matrix.stations
      .filter((s) => photos[s.slug]?.length && s.ridership)
      .sort((a, b) => b.ridership - a.ridership)
      .slice(0, FEATURED_COUNT)
      .map((s) => {
        const photo = photos[s.slug][0];
        return { ...photo, caption: photo.caption ? `${s.name_ja} — ${photo.caption}` : s.name_ja };
      });
  }, [photos, matrix]);
  const focus = matches.find((s) => photos?.[s.slug]?.length);
  const heroPhotos = focus ? photos[focus.slug] : featured;

  const purposes = useMemo(
    () =>
      table
        ? PRESETS.filter((p) => p.key !== "balance").map((preset) => {
            const weights = presetWeights(preset.key);
            return { preset, weights, rows: searchStations(table, { weights }).results.slice(0, PURPOSE_LIMIT) };
          })
        : [],
    [table]
  );
  const ranking = useMemo(
    () => (table ? [...table.rows].sort((a, b) => b.total - a.total).slice(0, RANKING_LIMIT) : []),
    [table]
  );

  return (
    <div className="page">
      <PhotoHero photos={heroPhotos} resetKey={focus?.slug ?? "featured"} className="hero-home">
        <SiteHeader />
        <div className="hero-home-body">
          <h1 className="hero-home-title">
            <span>駅の</span>
            <span>暮らしやすさを、</span>
            <span>{MAX_TOTAL}点で。</span>
          </h1>
          <p className="hero-home-lead">
            全国{stations.length}駅の徒歩5〜20分圏内にある19種類の施設を数え、買い物・食事・医療・子育て・生活・余暇の6分野で採点。住宅地の地価と乗降客数も並べて見られます。
          </p>
          <form
            className="hero-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches[0]) navigate(`/${matches[0].slug}`);
            }}
          >
            <label className="vh" htmlFor="station-search">
              駅名で探す
            </label>
            <input
              id="station-search"
              type="search"
              autoComplete="off"
              placeholder="駅名・よみがなで探す（例: 池袋）"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            {q && (
              <ul className="hero-search-results">
                {matches.length === 0 && <li className="hero-search-empty">該当する駅がありません</li>}
                {matches.map((s) => (
                  <li key={s.slug}>
                    <Link to={`/${s.slug}`}>
                      {s.name_ja}
                      <small>{s.prefecture}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </form>
          <Link className="hero-home-cta" to="/search">
            駅名が決まっていない方は、条件から探す →
          </Link>
        </div>
      </PhotoHero>

      <main className="page-body">
        <section className="block">
          <h2 className="block-title">総合点の高い駅（徒歩10分圏内）</h2>
          <p className="note-text">
            6分野の点の平均（小数1桁）。施設ごとに全国の対応駅の中での位置を出しているので、満点で頭打ちにならず上位の駅にも差がつきます。
          </p>
          {!table && <p className="status-message">読み込み中...</p>}
          {table && (
            <ol className="rank-list">
              {ranking.map((row, i) => (
                <li key={row.station.slug}>
                  <span className="rank-no">{i + 1}</span>
                  <Link className="rank-name" to={`/${row.station.slug}`}>
                    {row.station.name_ja}
                    <small>{row.station.prefecture}</small>
                  </Link>
                  <span className="rank-bars" aria-hidden="true">
                    {DOMAINS.map((d) => (
                      <span key={d.key} style={{ "--dom": d.color, "--v": `${row.domains[d.key]}%` }} />
                    ))}
                  </span>
                  <span className="rank-total">
                    {row.total}
                    <small>点</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="legend" aria-hidden="true">
            {DOMAINS.map((d) => (
              <span key={d.key} style={{ "--dom": d.color }}>
                {d.label}
              </span>
            ))}
          </p>
        </section>

        <section className="block">
          <h2 className="block-title">暮らし方から探す</h2>
          <p className="note-text">
            目的に合う分野の点が高い駅の上位{PURPOSE_LIMIT}駅です（徒歩10分圏内）。都道府県や最低軒数で絞り込むこともできます。
          </p>
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
                          {resultReasons(row, weights, 2)
                            .map((r) => `${r.label} ${r.score}`)
                            .join("・")}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <Link className="purpose-more" to={`/search?preset=${preset.key}`}>
                    この条件で絞り込む →
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        {docNav && (
          <section className="block">
            <h2 className="block-title">データで見る駅選び</h2>
            <p className="note-text">全国の駅の施設・地価・乗降客数・ハザードマップのデータから分かったことをまとめています。</p>
            <ul className="doc-cards">
              {docNav.articles.map((x) => (
                <li key={x.slug}>
                  <Link to={`/article/${x.slug}`}>
                    <b>{x.heading}</b>
                    <span>{x.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {docNav && (
          <section className="block">
            <h2 className="block-title">路線から探す</h2>
            <p className="note-text">路線ごとに、このサイトで扱っている駅を住みやすさの順に並べています。</p>
            <div className="chips">
              {[...docNav.lines]
                .sort((x, y) => y.count - x.count)
                .slice(0, TOP_LINES_LIMIT)
                .map((l) => (
                  <Link className="chip" key={l.slug} to={`/line/${l.slug}`}>
                    {l.name}
                    <small>{l.count}駅</small>
                  </Link>
                ))}
            </div>
            <Link className="purpose-more" to="/lines">
              すべての路線（{docNav.lines.length}路線） →
            </Link>
          </section>
        )}

        {/* 2026-09-30、1,856駅に増やしたので全駅を並べるのをやめ、都道府県ページへの入口にした（prerender.js と同じ形） */}
        {docNav && (
          <section className="block">
            <h2 className="block-title">都道府県から探す（{stations.length}駅）</h2>
            <div className="chips">
              {docNav.prefectures.map((g) =>
                g.slug ? (
                  <Link className="chip" key={g.name} to={`/pref/${g.slug}`}>
                    {g.name}
                    <small>{g.count}駅</small>
                  </Link>
                ) : (
                  g.stations.map((s) => (
                    <Link className="chip" key={s.slug} to={`/${s.slug}`}>
                      {s.name_ja}
                      <small>{g.name}</small>
                    </Link>
                  ))
                )
              )}
            </div>
            <Link className="purpose-more" to="/prefectures">
              都道府県ごとの一覧と比較 →
            </Link>
          </section>
        )}
      </main>

      <Footer />
      <BottomNav />
    </div>
  );
}
