import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchFacilityCounts } from "../api";
import { CATEGORIES } from "../categories";
import AdSlot from "../components/AdSlot";
import NotFound from "./NotFound";

export default function StationPage({ stations }) {
  const { stationSlug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | not-found | error

  const station = stations.find((s) => s.slug === stationSlug);

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
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [stationSlug, station]);

  if (!station) {
    return <NotFound />;
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>住みやすさ駅前スコア</h1>
        <p className="app-subtitle">駅名を選ぶと、周辺のコンビニ・病院・スーパー・飲食店の数がわかります</p>
      </header>

      <label className="station-select-label">
        駅を選択
        <select
          value={stationSlug}
          onChange={(e) => navigate(`/${e.target.value}`)}
        >
          {stations.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name_ja}
            </option>
          ))}
        </select>
      </label>

      {status === "loading" && <p className="status-message">読み込み中...</p>}
      {status === "error" && <p className="status-message status-error">データの取得に失敗しました。時間をおいて再度お試しください。</p>}
      {status === "not-found" && (
        <p className="status-message">この駅の集計データはまだ準備できていません。</p>
      )}

      {status === "ok" && data && (
        <>
          <p className="range-note">
            集計範囲: 駅から徒歩{data.walk_minutes}分圏内（直線距離換算、半径{data.radius_m}m）
          </p>

          <div className="category-grid">
            {CATEGORIES.map((cat) => (
              <div className="category-card" key={cat.key}>
                <div className="category-icon" aria-hidden="true">{cat.icon}</div>
                <div className="category-label">{cat.label}</div>
                <div className="category-count">{data.counts[cat.key]}<span className="unit">軒</span></div>
                {cat.note && <div className="category-note">（{cat.note}）</div>}
              </div>
            ))}
          </div>

          <p className="disclaimer">
            店舗数はOpenStreetMapのデータに基づく目安です。実際の店舗数と異なる場合があります。
            <br />
            データ更新日時: {data.updated_at}
          </p>
          <p className="attribution">
            地図データ: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>
          </p>
        </>
      )}

      <AdSlot />
    </div>
  );
}
