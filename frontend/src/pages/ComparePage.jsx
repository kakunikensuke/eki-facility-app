import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFacilityCounts } from "../api";
import BottomNav from "../components/BottomNav";
import ContentBlocks from "../components/ContentBlocks";
import Footer from "../components/Footer";
import { COMPARE_BLOCKS } from "../content/pages";
import { DOMAINS, MAX_TOTAL, formatPeople, formatYenPerM2, itemsOfDomain } from "../livabilityDefs";
import { STATIC_PAGES } from "../pageMeta";
import { useDocumentMeta } from "../useDocumentTitle";

const META = STATIC_PAGES.find((p) => p.path === "/compare");

// 2駅を並べて比べるページ（2026-07-17追加、2026-09-29に6分野版へ作り直し）。
// 比較は既定の徒歩10分圏に固定する。段階も変えられると「どの範囲で比べているか」が
// 分かりにくくなるため（段階の比較は駅ページで行う）。
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

function StationSelect({ label, value, onChange, stations }) {
  return (
    <label className="compare-pick">
      <span>{label}</span>
      <select className="search-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択してください</option>
        {stations.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name_ja}（{s.prefecture}）
          </option>
        ))}
      </select>
    </label>
  );
}

// 数値2つのうち大きい方に印を付ける（同じなら両方付けない）
const lead = (a, b) => (a > b ? " is-lead" : "");

export default function ComparePage({ stations }) {
  useDocumentMeta(META.title, META.description);
  const [slugA, setSlugA] = useState(stations[0]?.slug ?? "");
  const [slugB, setSlugB] = useState(stations[1]?.slug ?? "");
  const { data: a, status: statusA } = useStationData(slugA);
  const { data: b, status: statusB } = useStationData(slugB);

  const same = Boolean(slugA) && slugA === slugB;
  const ta = a?.tiers?.[a.default_walk_minutes];
  const tb = b?.tiers?.[b.default_walk_minutes];
  const ready = !same && statusA === "ok" && statusB === "ok" && ta && tb && a.slug === slugA && b.slug === slugB;

  return (
    <div className="page">
      <header className="page-head">
        <Link className="page-head-brand" to="/">
          住みやすさ駅前スコア
        </Link>
        <h1 className="page-head-title">駅を比較する</h1>
        <p className="page-head-lead">2つの駅を、6分野の点・施設の数・地価・乗降客数で並べて比べます（徒歩10分圏内）。</p>
      </header>

      <main className="page-body">
        <section className="block">
          <div className="compare-picks">
            <StationSelect label="駅A" value={slugA} onChange={setSlugA} stations={stations} />
            <StationSelect label="駅B" value={slugB} onChange={setSlugB} stations={stations} />
          </div>

          {same && <p className="status-message">異なる2駅を選んでください。</p>}
          {!same && (statusA === "loading" || statusB === "loading") && (
            <p className="status-message">読み込み中...</p>
          )}
          {!same && (statusA === "error" || statusB === "error") && (
            <p className="status-message status-error">データの取得に失敗しました。時間をおいて再度お試しください。</p>
          )}
          {!same && (statusA === "not-found" || statusB === "not-found") && (
            <p className="status-message">選択した駅の集計データはまだ準備できていません。</p>
          )}
        </section>

        {ready && (
          <section className="block">
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">
                    <Link to={`/${a.slug}`}>{a.name_ja}</Link>
                  </th>
                  <th scope="col">
                    <Link to={`/${b.slug}`}>{b.name_ja}</Link>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="compare-total">
                  <th scope="row">総合点</th>
                  <td className={lead(ta.total, tb.total)}>
                    {ta.total}
                    <small>/{MAX_TOTAL}・{ta.rank}位</small>
                  </td>
                  <td className={lead(tb.total, ta.total)}>
                    {tb.total}
                    <small>/{MAX_TOTAL}・{tb.rank}位</small>
                  </td>
                </tr>
                {DOMAINS.map((d) => (
                  <tr key={d.key}>
                    <th scope="row">
                      <span className="cat-dot" style={{ background: d.color }} aria-hidden="true" />
                      {d.label}
                    </th>
                    <td className={lead(ta.domains[d.key].score, tb.domains[d.key].score)}>
                      {ta.domains[d.key].score.toFixed(1)}
                    </td>
                    <td className={lead(tb.domains[d.key].score, ta.domains[d.key].score)}>
                      {tb.domains[d.key].score.toFixed(1)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">住宅地の地価</th>
                  <td>{a.public.land ? `${formatYenPerM2(a.public.land.median_yen_per_m2)}/m²` : "—"}</td>
                  <td>{b.public.land ? `${formatYenPerM2(b.public.land.median_yen_per_m2)}/m²` : "—"}</td>
                </tr>
                <tr>
                  <th scope="row">1日の乗降客数</th>
                  <td>{a.public.ridership ? formatPeople(a.public.ridership.daily) : "—"}</td>
                  <td>{b.public.ridership ? formatPeople(b.public.ridership.daily) : "—"}</td>
                </tr>
                {DOMAINS.map((d) => (
                  <CompareItems key={d.key} domain={d} ta={ta} tb={tb} />
                ))}
              </tbody>
            </table>
            <p className="note-text">
              施設の数はOpenStreetMap、地価と乗降客数は国土数値情報（国土交通省、CC BY 4.0）に基づきます。
            </p>
          </section>
        )}

        <section className="block prose">
          <ContentBlocks blocks={COMPARE_BLOCKS} />
        </section>
      </main>

      <Footer />
      <BottomNav />
    </div>
  );
}

function CompareItems({ domain, ta, tb }) {
  return (
    <>
      <tr className="compare-group">
        <th colSpan={3} scope="colgroup">
          {domain.label}の施設（軒）
        </th>
      </tr>
      {itemsOfDomain(domain.key).map((item) => {
        const x = ta.items[item.key].count;
        const y = tb.items[item.key].count;
        return (
          <tr key={item.key}>
            <th scope="row">{item.label}</th>
            <td className={lead(x, y)}>{x}</td>
            <td className={lead(y, x)}>{y}</td>
          </tr>
        );
      })}
    </>
  );
}
