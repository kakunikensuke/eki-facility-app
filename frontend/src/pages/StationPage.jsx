import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchFacilityCounts } from "../api";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import PhotoHero from "../components/PhotoHero";
import SiteHeader from "../components/SiteHeader";
import { toggleFavorite, useFavorites } from "../favorites";
import { DOMAINS, MAX_TOTAL, formatPeople, formatYenPerM2, itemsOfDomain } from "../livabilityDefs";
import { findNearbyStations, formatDistance } from "../nearbyStations";
import { stationTitle, stationDescription } from "../pageMeta";
import {
  categoryReachText,
  concentrationText,
  landText,
  nearestComparisonText,
  photoCredit,
  ridershipText,
  similarLead,
  similarStationText,
  summaryText,
  topShare,
} from "../stationProfileText";
import { useDocumentMeta } from "../useDocumentTitle";
import NotFound from "./NotFound";

// 駅ページ（2026-09-29に作り直し）。
// 表示データは scripts/stationBundle.js が駅ごとに作ったもの（/api/facility-counts/<slug>.json）。
// 静的HTML（scripts/prerender.js の stationPage）も同じデータ・同じ文言関数から組むので、
// ここに文章を直書きしないこと（stationProfileText.js に置く）。
export default function StationPage({ stations }) {
  const { stationSlug } = useParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | not-found | error
  const [walkMinutes, setWalkMinutes] = useState(null);
  const favorites = useFavorites();

  const station = stations.find((s) => s.slug === stationSlug);
  const favorited = favorites.includes(stationSlug);

  useEffect(() => {
    if (!station) {
      setStatus("not-found");
      return;
    }
    setStatus("loading");
    fetchFacilityCounts(stationSlug)
      .then((result) => {
        if (result === null) {
          setStatus("not-found");
          return;
        }
        setData(result);
        setWalkMinutes(result.default_walk_minutes);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [stationSlug, station]);

  // descriptionは既定の段階を基準にする（プリレンダの文言と揃える）
  const metaTier = data?.tiers?.[data?.default_walk_minutes];
  useDocumentMeta(
    station ? stationTitle(station.name_ja) : undefined,
    station && metaTier ? stationDescription(station.name_ja, metaTier) : undefined
  );

  if (!station) return <NotFound />;

  const ready = status === "ok" && data?.slug === stationSlug;
  const tier = ready ? data.tiers[walkMinutes] ?? data.tiers[data.default_walk_minutes] : null;
  const defaultTier = ready ? data.tiers[data.default_walk_minutes] : null;
  const nearby = findNearbyStations(station, stations);

  const readTexts = ready
    ? [
        categoryReachText(data.category_reach, data.default_walk_minutes),
        concentrationText(data.concentration),
        nearestComparisonText(station.name_ja, data.nearest, data.default_walk_minutes),
      ].filter(Boolean)
    : [];

  return (
    <div className="page">
      <PhotoHero photos={ready ? data.photos : []} resetKey={stationSlug} className="hero-station">
        <SiteHeader />
        <div className="hero-station-body">
          <p className="hero-eyebrow">
            {station.prefecture}
            {station.kana && <span className="hero-kana">{station.kana}</span>}
          </p>
          <h1 className="hero-title">{station.name_ja}</h1>
          {defaultTier && (
            <div className="hero-score">
              <span className="hero-score-value">{defaultTier.total}</span>
              <span className="hero-score-max">/ {MAX_TOTAL}</span>
              <span className="hero-score-rank">
                全{defaultTier.of}駅中 <b>{defaultTier.rank}</b> 位
                <small>（徒歩{defaultTier.walk_minutes}分圏内）</small>
              </span>
            </div>
          )}
          <button
            type="button"
            className="hero-fav"
            aria-pressed={favorited}
            onClick={() => toggleFavorite(stationSlug)}
          >
            {favorited ? "★ お気に入り済み" : "☆ お気に入りに追加"}
          </button>
        </div>
      </PhotoHero>

      <main className="page-body">
        {status === "loading" && <p className="status-message">読み込み中...</p>}
        {status === "error" && (
          <p className="status-message status-error">
            データの取得に失敗しました。時間をおいて再度お試しください。
          </p>
        )}
        {status === "not-found" && (
          <p className="status-message">この駅の集計データはまだ準備できていません。</p>
        )}

        {ready && tier && (
          <>
            <section className="block">
              <div className="block-head">
                <h2 className="block-title">6分野の評価</h2>
                <div className="seg" role="group" aria-label="集計範囲（徒歩分数）">
                  {data.walk_minutes.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={minutes === tier.walk_minutes}
                      onClick={() => setWalkMinutes(minutes)}
                    >
                      徒歩{minutes}分
                    </button>
                  ))}
                </div>
              </div>
              <p className="lead-text">{summaryText(station.name_ja, tier)}</p>
              <p className="note-text">
                駅から半径{tier.radius_m}m（徒歩1分=80m）以内の施設を数え、施設ごとに全国{tier.of}
                駅の中での位置を出して、分野ごとに平均しています。総合点は6分野の点の平均です。
              </p>

              <div className="domain-grid">
                {DOMAINS.map((domain) => {
                  const d = tier.domains[domain.key];
                  return (
                    <article className="domain" key={domain.key} style={{ "--dom": domain.color }}>
                      <header className="domain-head">
                        <h3>{domain.label}</h3>
                        <span className="domain-rank">{d.rank}位</span>
                      </header>
                      <p className="domain-score">
                        <b>{d.score.toFixed(1)}</b>
                        <small>/ 100</small>
                      </p>
                      <div className="domain-bar" aria-hidden="true">
                        <span style={{ width: `${d.score}%` }} />
                      </div>
                      <ul className="domain-items">
                        {itemsOfDomain(domain.key).map((item) => {
                          const it = tier.items[item.key];
                          return (
                            <li key={item.key} title={item.note}>
                              <span className="domain-item-label">{item.label}</span>
                              <span className="domain-item-count">
                                {it.count}
                                <small>軒</small>
                              </span>
                              {/* 0軒に「上位◯%」を付けても意味をなさないので出さない */}
                              <span className="domain-item-share">
                                {it.count > 0 ? `上位${topShare(it.pct)}%` : ""}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>

            {(data.public.land || data.public.ridership) && (
              <section className="block">
                <h2 className="block-title">暮らしのコストと駅の規模</h2>
                <div className="fact-grid">
                  {data.public.land && (
                    <article className="fact">
                      <h3 className="fact-label">住宅地の地価（中央値）</h3>
                      <p className="fact-value">
                        {formatYenPerM2(data.public.land.median_yen_per_m2)}
                        <small>/m²</small>
                      </p>
                      <p className="fact-sub">
                        前年比 {data.public.land.change_pct > 0 ? "+" : ""}
                        {data.public.land.change_pct}%・高い方から{data.public.land.rank_high}番目
                      </p>
                      <p className="fact-text">{landText(data.public.land)}</p>
                    </article>
                  )}
                  {data.public.ridership && (
                    <article className="fact">
                      <h3 className="fact-label">1日の乗降客数</h3>
                      <p className="fact-value">{formatPeople(data.public.ridership.daily)}</p>
                      <p className="fact-sub">
                        対応駅で{data.public.ridership.rank}番目に多い
                      </p>
                      <p className="fact-text">{ridershipText(data.public.ridership)}</p>
                    </article>
                  )}
                </div>
                <p className="note-text">
                  出典: 国土数値情報（地価公示データ・駅別乗降客数データ）国土交通省（CC BY 4.0）を加工して作成
                </p>
              </section>
            )}

            {readTexts.length > 0 && (
              <section className="block">
                <h2 className="block-title">{station.name_ja}のデータの読み方</h2>
                {readTexts.map((text, i) => (
                  <p className="body-text" key={i}>
                    {text}
                  </p>
                ))}
              </section>
            )}

            {data.similar_stations.length > 0 && (
              <section className="block">
                <h2 className="block-title">{station.name_ja}と施設の揃い方が似ている駅</h2>
                <p className="note-text">{similarLead(data.default_walk_minutes)}</p>
                <ul className="link-list">
                  {data.similar_stations.map((item) => (
                    <li key={item.slug}>
                      <Link className="link-list-name" to={`/${item.slug}`}>
                        {item.name_ja}
                        {item.prefecture && <small>{item.prefecture}</small>}
                      </Link>
                      <p>{similarStationText(station.name_ja, item)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {nearby.length > 0 && (
              <section className="block">
                <h2 className="block-title">{station.name_ja}の近くの駅</h2>
                <div className="chips">
                  {nearby.map(({ station: s, km }) => (
                    <Link className="chip" key={s.slug} to={`/${s.slug}`}>
                      {s.name_ja}
                      <small>約{formatDistance(km)}</small>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="block block-quiet">
              <h2 className="block-title">データと写真について</h2>
              <p className="note-text">
                施設の数はOpenStreetMapのデータに基づく目安です（地図データ: ©{" "}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                  OpenStreetMap contributors
                </a>
                ）。実際の店舗数と異なる場合があります。データ更新日時: {data.updated_at}
              </p>
              {data.photos.length > 0 && (
                <>
                  <p className="note-text">
                    写真はWikipedia日本語版の「{data.photo_article}」の記事に掲載されているもの（Wikimedia Commons）です。
                  </p>
                  <ul className="credit-list">
                    {data.photos.map((photo) => (
                      <li key={photo.src}>
                        <a href={photo.page} target="_blank" rel="noreferrer">
                          {photo.caption || "写真"}
                        </a>{" "}
                        — {photoCredit(photo)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </main>

      <Footer />
      <BottomNav />
    </div>
  );
}
