import { useState } from "react";
import { MAP_TILE_CREDIT, mapCounts, mapLayout } from "../stationMap";

// 駅の周りの地図（2026-11-06追加）。配置の計算は src/stationMap.js にあり、
// 静的HTML（scripts/prerender.js の stationMapHtml）も同じ計算・同じクラス名で組む。
// 印を押すと、地図の下にその施設の名前と駅からの距離を出す（スマホでは title が見えないため）
export default function StationMap({ stationName, lat, lon, rows }) {
  const [picked, setPicked] = useState(null);
  const layout = mapLayout(lat, lon, rows);
  const counts = mapCounts(rows);

  return (
    <figure className="smap-figure">
      <div className="smap" role="img" aria-label={`${stationName}から徒歩10分圏内の施設の地図`}>
        {layout.tiles.map((t) => (
          <img
            key={t.src}
            className="smap-tile"
            src={t.src}
            alt=""
            loading="lazy"
            style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.size}%`, height: `${t.size}%` }}
          />
        ))}
        {layout.rings.map((r) => (
          <span className="smap-ring" key={r.label} style={{ width: `${r.size}%`, height: `${r.size}%` }}>
            <em>{r.label}</em>
          </span>
        ))}
        <span className="smap-station" title={stationName} />
        {layout.markers.map((m, i) => (
          <button
            type="button"
            key={i}
            className={`smap-dot${picked === i ? " is-picked" : ""}`}
            style={{ left: `${m.left}%`, top: `${m.top}%`, background: m.color }}
            title={m.label}
            aria-label={m.label}
            onClick={() => setPicked(picked === i ? null : i)}
          />
        ))}
      </div>
      <figcaption>
        <p className="smap-picked" aria-live="polite">
          {picked === null ? "印を押すと、施設の名前と駅からの距離が出ます。" : layout.markers[picked].label}
        </p>
        <ul className="smap-legend">
          {counts.map((c) => (
            <li key={c.key}>
              <i style={{ background: c.color }} />
              {c.label} {c.n}
            </li>
          ))}
        </ul>
        <p className="smap-credit">
          地図:{" "}
          <a href={MAP_TILE_CREDIT.href} target="_blank" rel="noreferrer">
            {MAP_TILE_CREDIT.text}
          </a>
          ／施設: ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
        </p>
      </figcaption>
    </figure>
  );
}
