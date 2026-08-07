import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchFacilityCounts } from "../api";
import { CATEGORIES, EXTRA_CATEGORIES } from "../categories";
import AdSlot from "../components/AdSlot";
import BottomNav from "../components/BottomNav";
import Footer from "../components/Footer";
import { toggleFavorite, useFavorites } from "../favorites";
import { buildStationComment } from "../stationComment";
import { getStationTags } from "../stationTags";
import { stationTitle, stationDescription } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";
import { DEFAULT_WALK_MINUTES } from "../walkTiers";
import NotFound from "./NotFound";

export default function StationPage({ stations }) {
  const { stationSlug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | not-found | error
  const [walkMinutes, setWalkMinutes] = useState(DEFAULT_WALK_MINUTES);
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
        // 集計途中の駅は既定の段階を持たないことがあるため、実際に返ってきた段階に寄せる
        if (!result.tiers[DEFAULT_WALK_MINUTES]) {
          setWalkMinutes(result.available_walk_minutes[0]);
        } else {
          setWalkMinutes(DEFAULT_WALK_MINUTES);
        }
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [stationSlug, station]);

  // アプリ内で駅を切り替えたときにtitle/descriptionを追随させる。
  // 初期表示分はビルド時のプリレンダが埋めているので、ここは遷移時のための処理。
  // hookは条件分岐より前に呼ぶ必要があるため、NotFoundの判定より上に置いている。
  // descriptionは既定の段階を基準にするため、タブ切り替えでは変えない（プリレンダの文言と揃える）。
  const metaTier = data?.tiers?.[data?.default_walk_minutes] ?? data?.tiers?.[walkMinutes];
  useDocumentMeta(
    station ? stationTitle(station.name_ja) : undefined,
    station && metaTier ? stationDescription(station.name_ja, metaTier) : undefined
  );

  if (!station) {
    return <NotFound />;
  }

  const tier = data?.tiers?.[walkMinutes] ?? null;
  const totalCount = tier
    ? CATEGORIES.reduce((sum, cat) => sum + (tier.counts[cat.key] || 0), 0)
    : 0;
  const stationTags = tier ? getStationTags(tier.tag_keys) : [];

  return (
    <div className="app-container">
      <header className="hero-header">
        <button
          type="button"
          className="favorite-toggle favorite-toggle-header"
          aria-label={favorited ? "お気に入りから削除" : "お気に入りに追加"}
          onClick={() => toggleFavorite(stationSlug)}
        >
          {favorited ? "★" : "☆"}
        </button>
        <div className="hero-top">
          <div className="app-logo">住みやすさ駅前スコア</div>
        </div>

        {status === "ok" && tier && (
          <div className="score-ring-row">
            <div className="side-stat">
              <div className="side-stat-value">{totalCount}</div>
              <div className="side-stat-label">合計軒数</div>
            </div>
            <div className="score-ring">
              <div className="score-ring-value">{tier.score.total}</div>
              <div className="score-ring-label">SCORE</div>
            </div>
            <div className="side-stat">
              <div className="side-stat-value">徒歩{tier.walk_minutes}分</div>
              <div className="side-stat-label">集計範囲</div>
            </div>
          </div>
        )}
      </header>

      <label className="station-select-label">
        駅を選択
        <select value={stationSlug} onChange={(e) => navigate(`/${e.target.value}`)}>
          {stations.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name_ja}
            </option>
          ))}
        </select>
      </label>

      {status === "loading" && <p className="status-message">読み込み中...</p>}
      {status === "error" && (
        <p className="status-message status-error">
          データの取得に失敗しました。時間をおいて再度お試しください。
        </p>
      )}
      {status === "not-found" && (
        <p className="status-message">この駅の集計データはまだ準備できていません。</p>
      )}

      {status === "ok" && tier && (
        <>
          <div className="walk-tabs" role="tablist" aria-label="集計範囲（徒歩分数）">
            {data.available_walk_minutes.map((minutes) => (
              <button
                key={minutes}
                type="button"
                role="tab"
                aria-selected={minutes === walkMinutes}
                className={`walk-tab${minutes === walkMinutes ? " walk-tab-active" : ""}`}
                onClick={() => setWalkMinutes(minutes)}
              >
                徒歩{minutes}分
              </button>
            ))}
          </div>
          <p className="walk-tabs-note">
            駅から半径{tier.radius_m}m以内が集計対象です（徒歩1分=80mで換算）。
          </p>

          <p className="station-comment">{buildStationComment(station.name_ja, tier)}</p>

          {stationTags.length > 0 && (
            <div className="station-tags">
              {stationTags.map((tag) => (
                <span className="station-tag" key={tag.key}>
                  {tag.label}
                </span>
              ))}
            </div>
          )}

          <div className="breakdown-card">
            {CATEGORIES.map((cat) => {
              const count = tier.counts[cat.key] || 0;
              const points = tier.score.breakdown[cat.key];
              const maxPoints = 100 / CATEGORIES.length;
              const widthPct = Math.max((points / maxPoints) * 100, 4);
              return (
                <div className="breakdown-item" key={cat.key}>
                  <div className="breakdown-row-top">
                    <span className="breakdown-label">
                      {cat.icon} {cat.label}
                      {cat.note && <span className="breakdown-note">（{cat.note}）</span>}
                    </span>
                    <span className="breakdown-value">{count}軒</span>
                  </div>
                  <div className="breakdown-bar">
                    <div
                      className={`breakdown-bar-fill breakdown-bar-${cat.key}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="extra-card">
            <div className="extra-card-title">その他の施設（スコア対象外）</div>
            {EXTRA_CATEGORIES.map((cat) => {
              const count = tier.counts[cat.key] || 0;
              return (
                <div className="extra-item" key={cat.key}>
                  <div className="extra-item-row">
                    <span className="extra-item-label">
                      <span className={`extra-item-dot extra-item-dot-${cat.key}`} />
                      {cat.icon} {cat.label}
                      {cat.note && <span className="extra-item-note">（{cat.note}）</span>}
                    </span>
                    <span className="extra-item-value">{count}軒</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="info-card">
            <p className="disclaimer">
              店舗数・スコアはOpenStreetMapのデータに基づく目安です。実際の店舗数と異なる場合があります。
              <br />
              データ更新日時: {data.updated_at}
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

          <AdSlot />
        </>
      )}

      <Footer />
      <BottomNav />
    </div>
  );
}
