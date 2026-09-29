import { useEffect, useState } from "react";
import { photoCredit } from "../stationProfileText";

// 1枚を見せる時間。切り替えのフェードは CSS（design.css の .hero-photo）で1.6秒かける
const SLIDE_MS = 6500;

// 写真を背景に敷き、ゆっくり拡大しながら切り替えるヒーロー（2026-09-29追加）。
// 写真は Wikimedia Commons のもの（backend/scripts/fetchStationPhotos.js）。
// 表示中の写真の撮影者とライセンスを必ず右下に出すこと（CC BY の条件）。
//
// photos が空のときは写真なしの背景（design.css の .hero-fallback）になる。
// resetKey が変わったら1枚目からやり直す（トップで検索中の駅が変わったとき）。
export default function PhotoHero({ photos, resetKey, className = "", children }) {
  const [index, setIndex] = useState(0);
  const count = photos?.length ?? 0;

  useEffect(() => setIndex(0), [resetKey]);

  useEffect(() => {
    if (count < 2) return undefined;
    // 動きを減らす設定の人には自動で切り替えない
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => clearInterval(timer);
  }, [count, resetKey]);

  const current = count > 0 ? photos[index % count] : null;

  return (
    <section className={`hero ${className}`}>
      <div className="hero-photos" aria-hidden="true">
        {count === 0 && <div className="hero-fallback" />}
        {photos?.map((photo, i) => (
          <div
            key={photo.src}
            className={`hero-photo${i === index % count ? " is-active" : ""}`}
            // 今の1枚と前後の1枚だけ読み込む（6枚を一度に読むと通信量が大きい）。
            // 前の1枚を外すとフェードアウトの途中で消えてしまうので残す
            style={
              [index % count, (index + 1) % count, (index - 1 + count) % count].includes(i)
                ? { backgroundImage: `url("${photo.src}")` }
                : undefined
            }
          />
        ))}
        <div className="hero-shade" />
      </div>

      <div className="hero-content">{children}</div>

      {current && (
        <p className="hero-credit">
          {current.caption && <span className="hero-caption">{current.caption}</span>}
          <a href={current.page} target="_blank" rel="noreferrer">
            {photoCredit(current)}
          </a>
          {count > 1 && (
            <span className="hero-dots" aria-hidden="true">
              {photos.map((p, i) => (
                <span key={p.src} className={i === index % count ? "is-active" : ""} />
              ))}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
