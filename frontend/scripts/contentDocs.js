// 路線ごとのページと、データから分かったことをまとめた記事を組み立てる（2026-09-29追加）。
//
// 本文HTMLはここで1回だけ作り、generateApiData.js（/api/docs/*.json → 画面の DocPage.jsx）と
// prerender.js（静的HTML）の両方がそのまま使う。画面とクローラの見る中身が構造的にずれない。
//
// 文章の鉄則（AdSense対策の教訓。memory/CLAUDE.md参照）:
// - すべての文をデータから導き、数字が変われば結論の言葉も変わるように書く
// - データで確かめられない理由付け（「オフィス街だから」など）は書かない
// - 同じ場所の別事業者の駅（「新大阪駅」と「Osaka Metro 新大阪駅」）は一覧で1つにまとめる
import { DOMAINS, formatPeople, formatYenPerM2 } from "../src/livabilityDefs.js";
import { DEPTH_LABELS, HAZARD_KINDS, HAZARD_NOTES, HAZARD_SOURCE } from "../src/hazardText.js";
import { PREF_PAGE_MIN, groupByPrefecture, prefectureSlug } from "../src/stationSearch.js";

const WALK = 10; // サイトの既定の段階（徒歩10分）
const PUBLIC_SOURCE =
  "出典: 国土数値情報（地価公示データ・駅別乗降客数データ）国土交通省（CC BY 4.0）を加工して作成";
const COLOCATED_KM = 0.4;

// --- HTMLの部品 ---------------------------------------------------------------

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
const a = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const stationLink = (b) => a(`/${b.slug}`, b.name_ja);
// 段落。文字列はエスケープし、{html} はそのまま入れる（リンクを文中に置くため）
const p = (...parts) => `<p>${parts.map((x) => (typeof x === "string" ? esc(x) : x.html)).join("")}</p>`;
const note = (text) => `<p class="doc-note">${esc(text)}</p>`;
const h2 = (text) => `<h2>${esc(text)}</h2>`;
const ul = (items) => `<ul>${items.map((x) => `<li>${typeof x === "string" ? esc(x) : x.html}</li>`).join("")}</ul>`;
const chips = (items) =>
  `<p class="doc-chips">${items.map((x) => `<a href="${esc(x.href)}">${esc(x.text)}${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</a>`).join("")}</p>`;

// 表。セルは文字列か { text, href, num, html }
function table(head, rows) {
  const cell = (c, tag) => {
    if (c === null || c === undefined) return `<${tag}>—</${tag}>`;
    if (typeof c !== "object") return `<${tag}>${esc(c)}</${tag}>`;
    const cls = c.num ? ' class="num"' : "";
    const inner = c.html ?? (c.href ? a(c.href, c.text) : esc(c.text));
    return `<${tag}${cls}>${inner}</${tag}>`;
  };
  return (
    `<div class="doc-table"><table><thead><tr>${head.map((h) => cell(h, "th")).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

// --- 数字の道具 ---------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;
const fmt1 = (v) => (Number.isInteger(round1(v)) ? String(round1(v)) : round1(v).toFixed(1));
const fmtR = (r) => r.toFixed(2);
const signed = (v) => `${v > 0 ? "+" : ""}${fmt1(v)}`;

function median(values) {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length === 0 ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (values) => values.reduce((x, y) => x + y, 0) / values.length;

function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

// 順位相関（スピアマン）。外れ値に引っぱられにくく「順位が揃っているか」を見るのに向く
function spearman(xs, ys) {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sx += (rx[i] - mx) ** 2;
    sy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sx * sy);
}

function correlationWords(r) {
  const abs = Math.abs(r);
  const dir = r >= 0 ? "正の" : "負の";
  if (abs >= 0.7) return `強い${dir}関係`;
  if (abs >= 0.4) return `中程度の${dir}関係`;
  if (abs >= 0.2) return `弱い${dir}関係`;
  return "ほとんど関係がない";
}

// 値の小さい順に4等分する（件数がなるべく揃うように）
function quartiles(rows, value) {
  const sorted = [...rows].sort((x, y) => value(x) - value(y));
  return [0, 1, 2, 3].map((q) => sorted.slice(Math.floor((sorted.length * q) / 4), Math.floor((sorted.length * (q + 1)) / 4)));
}

function distanceKm(x, y) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const h =
    Math.sin(toRad(y.lat - x.lat) / 2) ** 2 +
    Math.cos(toRad(x.lat)) * Math.cos(toRad(y.lat)) * Math.sin(toRad(y.lon - x.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// 並べた順に、すでに載せた駅から400m以内の駅を飛ばす（同じ場所の別事業者の駅を1つにする）
function dedupeColocated(list, limit = Infinity) {
  const out = [];
  for (const b of list) {
    if (out.some((x) => distanceKm(x, b) <= COLOCATED_KM)) continue;
    out.push(b);
    if (out.length >= limit) break;
  }
  return out;
}

const domainLabel = (key) => DOMAINS.find((d) => d.key === key).label;
const T = (b) => b.tiers[WALK];
const landOf = (b) => b.public.land?.median_yen_per_m2 ?? null;
const riderOf = (b) => b.public.ridership?.daily ?? null;

function strongestDomain(tier) {
  return DOMAINS.map((d) => ({ key: d.key, score: tier.domains[d.key].score })).sort((x, y) => y.score - x.score)[0];
}
function weakestDomain(tier) {
  return DOMAINS.map((d) => ({ key: d.key, score: tier.domains[d.key].score })).sort((x, y) => x.score - y.score)[0];
}

// --- 路線ページ・都道府県ページの共通部品 -------------------------------------------
// どちらも「ある駅の集まり」を同じ物差しで並べる。文章はすべて rows の数字から導く

function rankingSection(name, rows) {
  return [
    h2(`${name}の駅ランキング（徒歩${WALK}分圏内）`),
    table(
      ["順位", "駅", "総合点", "全国順位", "いちばん高い分野", "住宅地の地価", "1日の乗降客数"],
      rows.map((b, i) => {
        const t = T(b);
        const s = strongestDomain(t);
        return [
          { text: String(i + 1), num: true },
          { href: `/${b.slug}`, text: b.name_ja },
          { text: fmt1(t.total), num: true },
          { text: `${t.rank}位`, num: true },
          `${domainLabel(s.key)} ${fmt1(s.score)}`,
          landOf(b) ? { text: `${formatYenPerM2(landOf(b))}/m²`, num: true } : null,
          riderOf(b) ? { text: formatPeople(riderOf(b)), num: true } : null,
        ];
      })
    ),
    note("地価は駅から徒歩20分以内にある住宅地の地価公示の中央値、乗降客数は同じ場所の全事業者の合計です。"),
  ];
}

// scope は「路線内」「県内」など、文中で範囲を指す言葉
function trendSection(name, rows, ctx, { scope, byPrefecture }) {
  const { national } = ctx;
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const blocks = [h2(`${name}の傾向`)];
  const spread = round1(T(top).total - T(bottom).total);
  const spreadWords =
    spread >= 40
      ? `同じ${scope.replace(/内$/, "")}でも、駅によって周りの施設の揃い方が大きく違います。`
      : spread <= 15
        ? "駅ごとの差は比較的小さいです。"
        : "";
  blocks.push(
    p(
      "1位は",
      { html: stationLink(top) },
      `の${fmt1(T(top).total)}点（全国${T(top).rank}位）、最も低いのは`,
      { html: stationLink(bottom) },
      `の${fmt1(T(bottom).total)}点で、${scope}の差は${fmt1(spread)}点です。${spreadWords}`
    )
  );
  const groupMedian = median(rows.map((b) => T(b).total));
  const medDiff = groupMedian - national.medianTotal;
  blocks.push(
    p(
      `${scope}の中央値は${fmt1(groupMedian)}点で、全国${national.count}駅の中央値（${fmt1(national.medianTotal)}点）` +
        (medDiff >= 3 ? `より${fmt1(medDiff)}点高めです。` : medDiff <= -3 ? `より${fmt1(-medDiff)}点低めです。` : "とほぼ同じです。")
    )
  );

  const domainDiffs = DOMAINS.map((d) => ({
    key: d.key,
    diff: mean(rows.map((b) => T(b).domains[d.key].score)) - national.domainMeans[d.key],
  })).sort((x, y) => y.diff - x.diff);
  const best = domainDiffs[0];
  const worst = domainDiffs[domainDiffs.length - 1];
  if (worst.diff > 0) {
    blocks.push(
      p(
        `6分野の平均を全国の平均と比べると、すべての分野で上回っています。差が最も大きいのは${domainLabel(best.key)}（${signed(
          best.diff
        )}点）、最も小さいのは${domainLabel(worst.key)}（${signed(worst.diff)}点）です。`
      )
    );
  } else if (best.diff < 0) {
    blocks.push(
      p(
        `6分野の平均を全国の平均と比べると、すべての分野で下回っています。差が最も小さいのは${domainLabel(best.key)}（${signed(
          best.diff
        )}点）、最も大きいのは${domainLabel(worst.key)}（${signed(worst.diff)}点）です。`
      )
    );
  } else {
    blocks.push(
      p(
        `6分野の平均を全国の平均と比べると、最も上回っているのは${domainLabel(best.key)}（${signed(best.diff)}点）、` +
          `最も下回っているのは${domainLabel(worst.key)}（${signed(worst.diff)}点）です。`
      )
    );
  }

  const withLand = rows.filter(landOf);
  if (withLand.length >= 3) {
    const byLand = [...withLand].sort((x, y) => landOf(x) - landOf(y));
    const cheap = byLand[0];
    const dear = byLand[byLand.length - 1];
    const landMedian = median(withLand.map(landOf));
    const value = withLand.filter((b) => landOf(b) <= landMedian).sort((x, y) => T(y).total - T(x).total)[0];
    blocks.push(
      p(
        "住宅地の地価は、最も手頃な",
        { html: stationLink(cheap) },
        `で${formatYenPerM2(landOf(cheap))}/m²、最も高い`,
        { html: stationLink(dear) },
        `で${formatYenPerM2(landOf(dear))}/m²と、${fmt1(landOf(dear) / landOf(cheap))}倍の開きがあります。` +
          `${scope}で地価が中央値以下の駅のうち、総合点が最も高いのは`,
        { html: stationLink(value) },
        `（${fmt1(T(value).total)}点・${formatYenPerM2(landOf(value))}/m²）です。`
      )
    );
  }

  if (byPrefecture) {
    const prefs = new Map();
    for (const b of rows) prefs.set(b.prefecture, [...(prefs.get(b.prefecture) ?? []), b]);
    const prefList = [...prefs].filter(([, list]) => list.length >= 2);
    if (prefList.length >= 2) {
      blocks.push(
        p(
          `都道府県ごとの平均点は、${prefList
            .map(([pref, list]) => `${pref}（${list.length}駅）${fmt1(mean(list.map((b) => T(b).total)))}点`)
            .join("、")}です。`
        )
      );
    }
  }

  const withRider = rows.filter(riderOf).sort((x, y) => riderOf(y) - riderOf(x));
  if (withRider.length >= 3) {
    const biggest = withRider[0];
    blocks.push(
      p(
        "乗降客数が最も多い",
        { html: stationLink(biggest) },
        `（1日${formatPeople(riderOf(biggest))}）は、${scope}で${rows.indexOf(biggest) + 1}位です。` +
          `乗降客数と総合点の順位相関は${fmtR(
            spearman(
              withRider.map(riderOf),
              withRider.map((b) => T(b).total)
            )
          )}でした${withRider.length < 10 ? "（駅数が少ないので目安です）" : ""}。`
      )
    );
  }
  return blocks;
}

// 表に出す駅の上限。都道府県ページは東京都だけで500駅を超えるので、区域にかかる駅を多い順に絞る
const HAZARD_TABLE_LIMIT = 40;

function hazardSection(name, rows) {
  const withHazard = rows.filter((b) => b.hazard);
  if (withHazard.length === 0) return [];
  const blocks = [h2(`${name}の災害リスク（ハザードマップの想定）`)];
  const floodAt = withHazard.filter((b) => b.hazard.flood.at_station);
  const deep = withHazard.filter((b) => b.hazard.flood.deep_share_pct >= 50);
  const texts = [
    `${withHazard.length}駅のうち、駅の地点が洪水浸水想定区域（想定最大規模）に入っているのは${floodAt.length}駅です。`,
  ];
  if (deep.length > 0) {
    const names = deep.map((b) => b.name_ja);
    texts.push(
      `徒歩${WALK}分圏の半分以上で3m以上の浸水が想定されているのは${
        names.length > 15 ? `${names.slice(0, 15).join("・")}など${names.length}駅` : names.join("・")
      }です。`
    );
  }
  for (const kind of HAZARD_KINDS.filter((k) => k.key !== "flood")) {
    const count = withHazard.filter((b) => b.hazard[kind.key].share_pct > 0).length;
    if (count > 0) texts.push(`徒歩${WALK}分圏に${kind.area}がかかる駅は${count}駅です。`);
  }
  blocks.push(p(texts.join("")));

  const coverage = (b) => Math.max(...HAZARD_KINDS.map((k) => b.hazard[k.key].share_pct));
  let listed = withHazard;
  let limited = false;
  if (withHazard.length > HAZARD_TABLE_LIMIT) {
    listed = withHazard
      .filter((b) => coverage(b) > 0)
      .sort((x, y) => coverage(y) - coverage(x))
      .slice(0, HAZARD_TABLE_LIMIT);
    limited = true;
  }
  if (listed.length > 0) {
    blocks.push(
      table(
        ["駅", ...HAZARD_KINDS.map((k) => k.label), "駅の地点"],
        listed.map((b) => [
          { href: `/${b.slug}`, text: b.name_ja },
          ...HAZARD_KINDS.map((k) =>
            b.hazard[k.key].share_pct > 0 ? { text: `${fmt1(b.hazard[k.key].share_pct)}%`, num: true } : { text: "なし", num: true }
          ),
          HAZARD_KINDS.filter((k) => b.hazard[k.key].at_station)
            .map((k) => (k.water ? `${k.label}${DEPTH_LABELS[b.hazard[k.key].at_station]}` : k.label))
            .join("・") || "区域外",
        ])
      )
    );
  }
  blocks.push(
    note(
      (limited
        ? `表は区域のかかる割合が大きい${listed.length}駅だけを載せています。ほかの駅は各駅のページをご覧ください。`
        : "") + `数字は徒歩${WALK}分圏（半径800m）のうち区域がかかっている割合です。${HAZARD_NOTES.join("")}`
    )
  );
  blocks.push(note(HAZARD_SOURCE));
  return blocks;
}

function domainTopSection(scope, rows) {
  return [
    h2(`分野ごとの${scope}1位`),
    ul(
      DOMAINS.map((d) => {
        const b = [...rows].sort((x, y) => T(y).domains[d.key].score - T(x).domains[d.key].score)[0];
        return { html: `${esc(d.label)}: ${stationLink(b)}（${esc(fmt1(T(b).domains[d.key].score))}点）` };
      })
    ),
  ];
}

const lineChip = (l) => ({ href: `/line/${l.slug}`, text: l.name, sub: `${l.stations.length}駅` });

// --- 路線ページ ---------------------------------------------------------------

function linePage(line, ctx) {
  const { bundles, national, allLines } = ctx;
  const rows = line.stations
    .map((slug) => bundles.get(slug))
    .filter(Boolean)
    .sort((x, y) => T(y).total - T(x).total);
  const n = rows.length;
  const top = rows[0];
  const blocks = [];

  blocks.push(
    p(
      `${line.name}のうち、このサイトで扱っている${n}駅を、徒歩${WALK}分圏内の住みやすさ駅前スコア（100点満点）の順に並べました。` +
        `路線の全駅ではなく、全国${national.count}駅の対象に入っている駅だけです。`
    )
  );
  if (line.note) blocks.push(note(line.note));
  blocks.push(...rankingSection(line.name, rows));
  blocks.push(...trendSection(line.name, rows, ctx, { scope: "路線内", byPrefecture: true }));
  blocks.push(...hazardSection(line.name, rows));
  blocks.push(...domainTopSection("路線内", rows));

  // 乗り換えできる路線（同じ駅に乗っている路線）を先に、次に同じ都道府県を通る路線を並べる。
  // 全路線を並べると139本になり、どのページも同じリンクの束になるため絞る
  const mine = new Set(line.stations);
  const prefs = new Set(rows.map((b) => b.prefecture));
  const transfer = allLines.filter((l) => l.slug !== line.slug && l.stations.some((s) => mine.has(s)));
  const sameArea = allLines.filter(
    (l) =>
      l.slug !== line.slug &&
      !transfer.includes(l) &&
      l.stations.some((s) => prefs.has(bundles.get(s)?.prefecture))
  );
  if (transfer.length > 0) {
    blocks.push(h2("乗り換えできる路線"));
    blocks.push(chips(transfer.map(lineChip)));
  }
  if (sameArea.length > 0) {
    blocks.push(h2(`${[...prefs].join("・")}を通るほかの路線`));
    blocks.push(chips(sameArea.slice(0, 30).map(lineChip)));
  }
  blocks.push(p({ html: a("/lines", `すべての路線（${allLines.length}路線）`) }));

  blocks.push(h2("データについて"));
  blocks.push(
    p(
      "路線と駅の対応は国土数値情報の駅別乗降客数データの路線名から作っています。点数の出し方は",
      { html: a("/guide", "使い方・スコアの見方") },
      "をご覧ください。"
    )
  );
  blocks.push(note(PUBLIC_SOURCE));

  return {
    path: `/line/${line.slug}`,
    title: `${line.name}の住みやすい駅ランキング（${n}駅）｜地価・災害リスクも比較`,
    description: `${line.name}の${n}駅を、徒歩10分圏内の施設から出した住みやすさ駅前スコア（100点満点）で比較。1位は${top.name_ja}の${fmt1(
      T(top).total
    )}点。住宅地の地価・乗降客数・浸水想定区域も並べています。`,
    heading: `${line.name}の住みやすい駅`,
    kicker: "路線から探す",
    lead: `掲載${n}駅・1位は${top.name_ja}（${fmt1(T(top).total)}点）`,
    html: blocks.join(""),
  };
}

// --- 都道府県ページ（2026-09-30追加。掲載駅を1,856駅に増やしたときに、トップページから
// 全駅へ直接リンクする代わりの入口として作った） ------------------------------------

function prefPage(pref, rows, ctx) {
  const { national, allLines } = ctx;
  const n = rows.length;
  const top = rows[0];
  const blocks = [
    p(
      `${pref}で、このサイトが扱っている${n}駅を、徒歩${WALK}分圏内の住みやすさ駅前スコア（100点満点）の順に並べました。` +
        `対象は乗降客数の多い駅（おおむね1日1万人以上）と県庁所在地の駅が中心で、${pref}のすべての駅ではありません。`
    ),
  ];
  blocks.push(...rankingSection(pref, rows));
  blocks.push(...trendSection(pref, rows, ctx, { scope: `${pref}内`, byPrefecture: false }));

  // 全国の中での位置（上位4分の1に入る駅の数）
  const inTopQuarter = rows.filter((b) => T(b).total >= national.q75).length;
  blocks.push(
    p(
      `全国${national.count}駅の上位4分の1（${fmt1(national.q75)}点以上）に入るのは${n}駅中${inTopQuarter}駅` +
        `（${fmt1((inTopQuarter / n) * 100)}%）です。`
    )
  );

  blocks.push(...hazardSection(pref, rows));
  blocks.push(...domainTopSection(`${pref}内`, rows));

  const here = new Set(rows.map((b) => b.slug));
  const lines = allLines
    .map((l) => ({ l, count: l.stations.filter((s) => here.has(s)).length }))
    .filter((x) => x.count > 0)
    .sort((x, y) => y.count - x.count);
  if (lines.length > 0) {
    blocks.push(h2(`${pref}を通る路線`));
    blocks.push(chips(lines.map(({ l, count }) => ({ href: `/line/${l.slug}`, text: l.name, sub: `${pref}内${count}駅` }))));
  }

  blocks.push(h2("データについて"));
  blocks.push(
    p("点数の出し方は", { html: a("/guide", "使い方・スコアの見方") }, "をご覧ください。")
  );
  blocks.push(note(PUBLIC_SOURCE));

  return {
    path: `/pref/${prefectureSlug(pref)}`,
    title: `${pref}の住みやすい駅ランキング（${n}駅）｜地価・災害リスクも比較`,
    description: `${pref}の${n}駅を、徒歩10分圏内の施設から出した住みやすさ駅前スコア（100点満点）で比較。1位は${top.name_ja}の${fmt1(
      T(top).total
    )}点。住宅地の地価・乗降客数・浸水想定区域も並べています。`,
    heading: `${pref}の住みやすい駅`,
    kicker: "都道府県から探す",
    lead: `掲載${n}駅・1位は${top.name_ja}（${fmt1(T(top).total)}点）`,
    html: blocks.join(""),
  };
}

function prefsIndex(groups, ctx) {
  const { national } = ctx;
  const withPage = groups.filter((g) => g.rows.length >= PREF_PAGE_MIN);
  const small = groups.filter((g) => g.rows.length < PREF_PAGE_MIN);
  const byMedian = [...withPage].map((g) => ({ ...g, med: median(g.rows.map((b) => T(b).total)) })).sort((x, y) => y.med - x.med);
  const blocks = [
    p(
      small.length > 0
        ? `全国${national.count}駅を都道府県ごとに分けました。${PREF_PAGE_MIN}駅以上ある${withPage.length}都道府県は、` +
            "駅を住みやすさ駅前スコアの順に並べたページがあります。"
        : `全国${national.count}駅を都道府県ごとに分けました。${withPage.length}都道府県それぞれに、` +
            "駅を住みやすさ駅前スコアの順に並べたページがあります。"
    ),
    table(
      ["都道府県", "掲載駅数", "中央値", "1位の駅"],
      withPage.map((g) => {
        const med = median(g.rows.map((b) => T(b).total));
        return [
          { href: `/pref/${prefectureSlug(g.prefecture)}`, text: g.prefecture },
          { text: `${g.rows.length}駅`, num: true },
          { text: `${fmt1(med)}点`, num: true },
          { html: `${stationLink(g.rows[0])}（${esc(fmt1(T(g.rows[0]).total))}点）` },
        ];
      })
    ),
  ];
  if (byMedian.length >= 2) {
    blocks.push(
      p(
        `掲載駅の中央値が最も高いのは${byMedian[0].prefecture}（${fmt1(byMedian[0].med)}点）、最も低いのは` +
          `${byMedian[byMedian.length - 1].prefecture}（${fmt1(byMedian[byMedian.length - 1].med)}点）です。` +
          "駅の選び方（乗降客数の多い駅が中心）が都道府県によって違うので、都道府県そのものの住みやすさの比較ではありません。"
      )
    );
  }
  if (small.length > 0) {
    blocks.push(h2(`掲載駅が${PREF_PAGE_MIN}駅未満の都道府県`));
    // トップの「福井県 2駅」などはここ（/prefectures#fukui）へ飛ぶので、都道府県ごとに id を付ける
    blocks.push(
      `<ul>${small
        .map(
          (g) =>
            `<li id="${esc(prefectureSlug(g.prefecture))}">${esc(g.prefecture)}: ${g.rows
              .map((b) => `${stationLink(b)}（${esc(fmt1(T(b).total))}点）`)
              .join("、")}</li>`
        )
        .join("")}</ul>`
    );
  }
  return {
    path: "/prefectures",
    title: `都道府県から住みやすい駅を探す（${groups.length}都道府県・${national.count}駅）｜住みやすさ駅前スコア`,
    description: `全国${national.count}駅を都道府県ごとに、住みやすさ駅前スコア（100点満点）の順に並べています。住宅地の地価・乗降客数・災害リスクも比較できます。`,
    heading: "都道府県から探す",
    kicker: "都道府県から探す",
    lead: `${groups.length}都道府県・${national.count}駅`,
    html: blocks.join(""),
  };
}


function linesIndex(ctx) {
  const { bundles, allLines } = ctx;
  const rows = allLines.map((line) => {
    const list = line.stations.map((s) => bundles.get(s)).filter(Boolean);
    const top = [...list].sort((x, y) => T(y).total - T(x).total)[0];
    return { line, count: list.length, top, med: median(list.map((b) => T(b).total)) };
  });
  const byMedian = [...rows].sort((x, y) => y.med - x.med);
  const blocks = [
    p(
      `このサイトで扱っている駅が${Math.min(...rows.map((r) => r.count))}駅以上乗っている${rows.length}路線について、` +
        "駅を住みやすさ駅前スコアの順に並べたページを用意しています。路線の全駅ではなく、全国の対象駅に入っている駅だけを載せています。"
    ),
    p(
      `掲載駅の中央値で比べると、最も高いのは${byMedian[0].line.name}（${fmt1(byMedian[0].med)}点）、` +
        `最も低いのは${byMedian[byMedian.length - 1].line.name}（${fmt1(byMedian[byMedian.length - 1].med)}点）です。`
    ),
    table(
      ["路線", "掲載駅数", "中央値", "1位の駅"],
      byMedian.map((r) => [
        { href: `/line/${r.line.slug}`, text: r.line.name },
        { text: `${r.count}駅`, num: true },
        { text: `${fmt1(r.med)}点`, num: true },
        { html: `${stationLink(r.top)}（${esc(fmt1(T(r.top).total))}点）` },
      ])
    ),
    note("路線と駅の対応は国土数値情報（駅別乗降客数データ）国土交通省（CC BY 4.0）の路線名から作っています。"),
  ];
  return {
    path: "/lines",
    title: `路線から住みやすい駅を探す（${rows.length}路線）｜住みやすさ駅前スコア`,
    description: `山手線・中央線・京浜東北線・御堂筋線など${rows.length}路線について、駅を住みやすさ駅前スコア（100点満点）の順に並べ、地価と災害リスクも比較しています。`,
    heading: "路線から探す",
    kicker: "路線から探す",
    lead: `${rows.length}路線の駅を、住みやすさの順に並べています。`,
    html: blocks.join(""),
  };
}

// --- 記事（データで見る駅選び） -------------------------------------------------

const ARTICLE_KICKER = "データで見る駅選び";

function stationRow(b, extra = []) {
  return [{ href: `/${b.slug}`, text: b.name_ja }, b.prefecture, { text: fmt1(T(b).total), num: true }, ...extra];
}

function tally(list, key) {
  const m = new Map();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1]);
}

function readingNotes(items) {
  return [h2("読み方の注意"), ul(items)].join("");
}

const COMMON_NOTES = [
  `総合点は、徒歩${WALK}分圏内（半径800m）にある19種類の施設の数を全国の対象駅の中での位置に直し、6分野に分けて平均したものです。対象駅が変わると点数も少し動きます。`,
  "施設の数はOpenStreetMapのデータに基づく目安で、実際の店舗数と異なる場合があります。",
];

function articleCheapAndConvenient(ctx) {
  const { national } = ctx;
  const L = ctx.B.filter(landOf);
  const r = spearman(L.map(landOf), L.map((b) => T(b).total));
  const landMed = median(L.map(landOf));
  const qs = quartiles(L, landOf);
  const qMed = qs.map((q) => median(q.map((b) => T(b).total)));
  const picks = dedupeColocated(
    L.filter((b) => landOf(b) <= landMed).sort((x, y) => T(y).total - T(x).total),
    20
  );
  const good = picks.filter((b) => T(b).total >= national.q75);
  const cheapGood = L.filter((b) => landOf(b) <= landMed && T(b).total >= national.q75);
  const dearGood = L.filter((b) => landOf(b) > landMed && T(b).total >= national.q75);
  const LABELS = ["安い方の4分の1", "やや安い4分の1", "やや高い4分の1", "高い方の4分の1"];

  const blocks = [
    p(
      "駅の周りに店や病院がそろっている場所ほど、土地の値段も高くなりがちです。では、地価がそれほど高くないのに生活施設がそろっている駅はどこにあるのでしょうか。" +
        `全国${L.length}駅について、住宅地の地価（駅から徒歩20分以内の地価公示の中央値）と、徒歩${WALK}分圏内の住みやすさ駅前スコアを並べて調べました。`
    ),
    h2("地価と住みやすさの関係"),
    p(
      `地価と総合点の順位相関は${fmtR(r)}で、${correlationWords(r)}があります。` +
        `地価の安い方から4つに分けると、総合点の中央値は${qMed.map((m) => `${fmt1(m)}点`).join("→")}と` +
        (qMed[3] > qMed[0]
          ? `上がっていき、最も安い4分の1と最も高い4分の1では${fmt1(qMed[3] - qMed[0])}点の差があります。`
          : "並びます。")
    ),
    table(
      ["地価の帯", "駅数", "地価の範囲（1m²）", "総合点の中央値"],
      qs.map((q, i) => [
        LABELS[i],
        { text: `${q.length}駅`, num: true },
        { text: `${formatYenPerM2(landOf(q[0]))}〜${formatYenPerM2(landOf(q[q.length - 1]))}`, num: true },
        { text: `${fmt1(qMed[i])}点`, num: true },
      ])
    ),
    h2("地価が全国の中央値以下で、総合点が高い駅"),
    p(
      `地価が全国の中央値（${formatYenPerM2(landMed)}/m²）以下の駅に絞り、総合点の高い順に${picks.length}駅を並べました。同じ場所にある別の事業者の駅は1つにまとめています。` +
        `このうち総合点が全国の上位4分の1（${fmt1(national.q75)}点以上）に入るのは${good.length}駅です。`
    ),
    table(
      ["駅", "都道府県", "総合点", "全国順位", "住宅地の地価", "地価の高い方から"],
      picks.map((b) =>
        stationRow(b, [
          { text: `${T(b).rank}位`, num: true },
          { text: `${formatYenPerM2(landOf(b))}/m²`, num: true },
          { text: `${b.public.land.rank_high}番目`, num: true },
        ])
      )
    ),
    p(
      `都道府県別に数えると、${tally(picks, (b) => b.prefecture)
        .map(([pref, c]) => `${pref}${c}駅`)
        .join("、")}です。`
    ),
  ];

  if (cheapGood.length >= 5 && dearGood.length >= 5) {
    const diffs = DOMAINS.map((d) => {
      const x = mean(cheapGood.map((b) => T(b).domains[d.key].score));
      const y = mean(dearGood.map((b) => T(b).domains[d.key].score));
      return { d, x, y, diff: x - y };
    });
    const sorted = [...diffs].sort((u, v) => u.diff - v.diff);
    blocks.push(
      h2("手頃で便利な駅と、地価が高く便利な駅の違い"),
      p(
        `総合点が上位4分の1に入る駅を、地価が中央値以下の${cheapGood.length}駅と中央値より高い${dearGood.length}駅に分け、6分野の平均を比べました。` +
          `手頃な側が最も下回っているのは${sorted[0].d.label}（${signed(sorted[0].diff)}点）、` +
          (sorted[5].diff > 0
            ? `逆に上回っているのは${sorted[5].d.label}（${signed(sorted[5].diff)}点）です。`
            : `最も差が小さいのは${sorted[5].d.label}（${signed(sorted[5].diff)}点）です。`)
      ),
      table(
        ["分野", `手頃で便利（${cheapGood.length}駅）`, `地価が高く便利（${dearGood.length}駅）`, "差"],
        diffs.map((x) => [x.d.label, { text: fmt1(x.x), num: true }, { text: fmt1(x.y), num: true }, { text: signed(x.diff), num: true }])
      )
    );
  }

  blocks.push(
    readingNotes([
      "地価は家賃そのものではありません。住宅地の地価公示（標準地）の中央値で、駅によって集計した地点の数が違います。",
      "徒歩20分以内に住宅地の標準地が2地点未満の駅は、範囲を約3.2kmまで広げています。",
      ...COMMON_NOTES,
    ]),
    note(PUBLIC_SOURCE)
  );

  return {
    slug: "cheap-and-convenient",
    heading: "地価が安いのに生活施設がそろっている駅",
    title: "地価が安いのに生活施設がそろっている駅はどこか｜全国の住宅地の地価と住みやすさを比較",
    description: `全国${L.length}駅の住宅地の地価と住みやすさ駅前スコアを比べ、地価が全国の中央値以下で総合点が高い駅を${picks.length}駅選びました。地価と総合点の順位相関は${fmtR(r)}。`,
    summary: `地価と総合点の順位相関は${fmtR(r)}。地価が中央値以下で総合点が高い駅の1位は${picks[0].name_ja}（${fmt1(T(picks[0]).total)}点）。`,
    html: blocks.join(""),
  };
}

function articleRidership(ctx) {
  const { national } = ctx;
  const R = ctx.B.filter(riderOf);
  const r = spearman(R.map(riderOf), R.map((b) => T(b).total));
  const qs = quartiles(R, riderOf);
  const qMed = qs.map((q) => median(q.map((b) => T(b).total)));
  const riderMed = median(R.map(riderOf));
  const q75Rider = [...R.map(riderOf)].sort((x, y) => x - y)[Math.floor(R.length * 0.75)];
  const quietGood = dedupeColocated(
    R.filter((b) => riderOf(b) <= riderMed).sort((x, y) => T(y).total - T(x).total),
    12
  );
  const busyLow = dedupeColocated(
    R.filter((b) => riderOf(b) >= q75Rider).sort((x, y) => T(x).total - T(y).total),
    10
  );
  const LABELS = ["少ない方の4分の1", "やや少ない4分の1", "やや多い4分の1", "多い方の4分の1"];

  const blocks = [
    p(
      "乗降客数の多い大きな駅ほど、周りに店や病院が集まっていそうに思えます。実際にそうなのかを、全国" +
        `${R.length}駅の1日の乗降客数（同じ場所の全事業者の合計）と、徒歩${WALK}分圏内の住みやすさ駅前スコアで確かめました。`
    ),
    h2("乗降客数と住みやすさの関係"),
    p(
      `乗降客数と総合点の順位相関は${fmtR(r)}で、${correlationWords(r)}があります。` +
        `乗降客数の少ない方から4つに分けると、総合点の中央値は${qMed.map((m) => `${fmt1(m)}点`).join("→")}です。`
    ),
    table(
      ["乗降客数の帯", "駅数", "1日の乗降客数", "総合点の中央値"],
      qs.map((q, i) => [
        LABELS[i],
        { text: `${q.length}駅`, num: true },
        { text: `${formatPeople(riderOf(q[0]))}〜${formatPeople(riderOf(q[q.length - 1]))}`, num: true },
        { text: `${fmt1(qMed[i])}点`, num: true },
      ])
    ),
    p(
      "ただし、関係は一直線ではありません。乗降客数が中くらいでも総合点の高い駅がある一方、乗降客数が多くても点の伸びない駅があります。次の2つの表がその例です。"
    ),
    h2("乗降客数は少なめでも、総合点が高い駅"),
    p(
      `乗降客数が全国の中央値（1日${formatPeople(riderMed)}）以下の駅のうち、総合点の高い${quietGood.length}駅です。` +
        (quietGood.every((b) => T(b).total >= national.q75)
          ? `${quietGood.length}駅すべてが総合点の上位4分の1（${fmt1(national.q75)}点以上）に入ります。`
          : `上位4分の1（${fmt1(national.q75)}点以上）に入るのは${quietGood.filter((b) => T(b).total >= national.q75).length}駅です。`)
    ),
    table(
      ["駅", "都道府県", "総合点", "1日の乗降客数", "いちばん高い分野"],
      quietGood.map((b) =>
        stationRow(b, [
          { text: formatPeople(riderOf(b)), num: true },
          `${domainLabel(strongestDomain(T(b)).key)} ${fmt1(strongestDomain(T(b)).score)}`,
        ])
      )
    ),
    h2("乗降客数は多いのに、総合点が伸びない駅"),
    p(
      `乗降客数が全国の上位4分の1（1日${formatPeople(q75Rider)}以上）の駅のうち、総合点の低い${busyLow.length}駅です。` +
        "いちばん低い分野を見ると、どの施設が足りずに点が伸びていないのかが分かります。"
    ),
    table(
      ["駅", "都道府県", "総合点", "1日の乗降客数", "いちばん低い分野"],
      busyLow.map((b) =>
        stationRow(b, [
          { text: formatPeople(riderOf(b)), num: true },
          `${domainLabel(weakestDomain(T(b)).key)} ${fmt1(weakestDomain(T(b)).score)}`,
        ])
      )
    ),
    p(
      `この${busyLow.length}駅で多い「いちばん低い分野」は${tally(busyLow, (b) => weakestDomain(T(b)).key)
        .map(([k, c]) => `${domainLabel(k)}（${c}駅）`)
        .slice(0, 3)
        .join("、")}です。乗り換えや通勤の拠点としての大きさと、歩いて行ける範囲の暮らしの施設の多さは、別の物差しとして見る必要があります。`
    ),
    readingNotes([
      "乗降客数は事業者が公表している年度の値で、数字を公表していない小さな駅は含みません。",
      "同じ場所にある別の事業者の駅は、表では1つにまとめています。",
      ...COMMON_NOTES,
    ]),
    note(PUBLIC_SOURCE),
  ];

  return {
    slug: "ridership-vs-livability",
    heading: "乗降客数が多い駅ほど住みやすいのか",
    title: "乗降客数が多い駅ほど住みやすいのか｜全国の駅で乗降客数と周辺施設を比較",
    description: `全国${R.length}駅の1日の乗降客数と住みやすさ駅前スコアを比べました。順位相関は${fmtR(r)}。乗降客数が少なめでも点が高い駅、多いのに点が伸びない駅も紹介します。`,
    summary: `順位相関は${fmtR(r)}（${correlationWords(r)}）。乗降客数が中央値以下で総合点が最も高いのは${quietGood[0].name_ja}。`,
    html: blocks.join(""),
  };
}

function articleWalkRange(ctx) {
  const B = ctx.B.filter((b) => b.tiers[5] && b.tiers[20]);
  const r = spearman(
    B.map((b) => b.tiers[5].total),
    B.map((b) => b.tiers[20].total)
  );
  const moves = B.map((b) => ({ ...b, r5: b.tiers[5].rank, r20: b.tiers[20].rank, d: b.tiers[5].rank - b.tiers[20].rank }));
  const up = dedupeColocated([...moves].sort((x, y) => y.d - x.d), 12);
  const down = dedupeColocated([...moves].sort((x, y) => x.d - y.d), 12);
  const big = moves.filter((m) => Math.abs(m.d) >= 100).length;
  const row = (m) => [
    { href: `/${m.slug}`, text: m.name_ja },
    m.prefecture,
    { text: `${m.r5}位（${fmt1(m.tiers[5].total)}点）`, num: true },
    { text: `${m.r20}位（${fmt1(m.tiers[20].total)}点）`, num: true },
  ];

  const blocks = [
    p(
      "駅の住みやすさは、どこまで歩くつもりかで変わります。駅のすぐ前に店が集まっている駅もあれば、駅前は静かでも少し歩くと商店街や病院が広がっている駅もあります。" +
        `全国${B.length}駅の住みやすさ駅前スコアを、徒歩5分圏（半径400m）と徒歩20分圏（半径1600m）で出し直し、順位の動きを比べました。`
    ),
    h2("徒歩5分と20分の順位はどのくらい一致するか"),
    p(
      `2つの範囲の総合点の順位相関は${fmtR(r)}で、${correlationWords(r)}があります。大まかな順位は似ていますが、` +
        `全${B.length}駅のうち${big}駅は順位が100位以上動きます。住む場所を選ぶときは、自分が普段歩く距離の点数で比べる方が実態に近くなります。`
    ),
    h2("歩く範囲を広げると順位が上がる駅"),
    p("徒歩5分圏では順位が低く、徒歩20分圏では高い駅です。駅前の施設は少なめでも、少し歩けば生活に必要なものがそろっている駅と読めます。"),
    table(["駅", "都道府県", "徒歩5分圏", "徒歩20分圏"], up.map(row)),
    h2("駅のすぐ前に施設が集まっている駅"),
    p(
      "反対に、徒歩5分圏では順位が高く、徒歩20分圏では下がる駅です。駅前に施設が集中していて、離れると他の駅ほどは増えない駅と読めます。駅の近くに住めるかどうかで暮らしやすさが大きく変わります。"
    ),
    table(["駅", "都道府県", "徒歩5分圏", "徒歩20分圏"], down.map(row)),
    p(
      "駅ページでは、徒歩5・10・15・20分の4段階を切り替えて点数を見られます。候補の駅がどちらの型かを確かめるのに使ってください。",
      { html: `${a("/search", "条件で駅を探す")}でも、徒歩の段階を選んで並べ替えられます。` }
    ),
    readingNotes([
      "点数は段階ごとに全国の対象駅の中での位置として出し直しています。徒歩20分圏の点が高いことは、施設の数が他の駅の徒歩20分圏と比べて多いという意味です。",
      "半径は直線距離です。川や線路で実際には遠回りになる場所も含みます。",
      COMMON_NOTES[1],
    ]),
  ];

  return {
    slug: "walk-5-vs-20",
    heading: "徒歩5分と20分で順位が大きく入れ替わる駅",
    title: "徒歩5分と徒歩20分で住みやすさの順位が大きく入れ替わる駅｜駅前集中型と周辺充実型",
    description: `全国${B.length}駅の住みやすさ駅前スコアを徒歩5分圏と徒歩20分圏で比べ、順位が大きく上がる駅・下がる駅を${up.length}駅ずつ紹介します。`,
    summary: `徒歩5分と20分の順位相関は${fmtR(r)}。${big}駅は順位が100位以上動く。最も上がるのは${up[0].name_ja}（${up[0].r5}位→${up[0].r20}位）。`,
    html: blocks.join(""),
  };
}

function articlePrefectures(ctx) {
  const { national } = ctx;
  const groups = tally(ctx.B, (b) => b.prefecture)
    .filter(([, c]) => c >= 5)
    .map(([pref]) => {
      const list = ctx.B.filter((b) => b.prefecture === pref);
      const lands = list.filter(landOf).map(landOf);
      const rel = DOMAINS.map((d) => ({
        key: d.key,
        diff: mean(list.map((b) => T(b).domains[d.key].score)) - national.domainMeans[d.key],
      })).sort((x, y) => y.diff - x.diff);
      return {
        pref,
        list,
        med: median(list.map((b) => T(b).total)),
        top: [...list].sort((x, y) => T(y).total - T(x).total)[0],
        land: lands.length > 0 ? median(lands) : null,
        strong: rel[0],
        weak: rel[rel.length - 1],
      };
    })
    .sort((x, y) => y.med - x.med);
  const small = tally(ctx.B, (b) => b.prefecture).filter(([, c]) => c < 5);
  const first = groups[0];
  const last = groups[groups.length - 1];

  const blocks = [
    p(
      `このサイトで扱っている全国${national.count}駅を都道府県ごとにまとめ、住みやすさ駅前スコア（徒歩${WALK}分圏内）の中央値、住宅地の地価、全国平均と比べて強い分野・弱い分野を並べました。` +
        `駅が5駅以上ある${groups.length}都道府県が対象です。`
    ),
    h2("都道府県ごとの一覧"),
    table(
      ["都道府県", "駅数", "総合点の中央値", "最も高い駅", "地価の中央値", "全国平均との差が最も大きい分野", "最も小さい分野"],
      groups.map((g) => [
        g.pref,
        { text: `${g.list.length}駅`, num: true },
        { text: `${fmt1(g.med)}点`, num: true },
        { html: `${stationLink(g.top)}（${esc(fmt1(T(g.top).total))}点）` },
        g.land ? { text: `${formatYenPerM2(g.land)}/m²`, num: true } : null,
        `${domainLabel(g.strong.key)}（${signed(g.strong.diff)}）`,
        `${domainLabel(g.weak.key)}（${signed(g.weak.diff)}）`,
      ])
    ),
    h2("分かったこと"),
    p(
      `中央値が最も高いのは${first.pref}（${first.list.length}駅）の${fmt1(first.med)}点、最も低いのは${last.pref}（${last.list.length}駅）の${fmt1(last.med)}点で、${fmt1(
        first.med - last.med
      )}点の開きがあります。`
    ),
  ];

  const byLand = groups.filter((g) => g.land);
  if (byLand.length >= 3) {
    const r = spearman(
      byLand.map((g) => g.land),
      byLand.map((g) => g.med)
    );
    blocks.push(
      p(
        `都道府県ごとの地価の中央値と総合点の中央値の順位相関は${fmtR(r)}です。` +
          (r >= 0.4
            ? "地価の高い都道府県ほど、駅の周りの施設もそろっている傾向があります。"
            : "都道府県単位では、地価と総合点の並びはあまり一致しません。")
      )
    );
  }
  const weakTally = tally(groups, (g) => g.weak.key);
  blocks.push(
    p(
      `全国平均との差が最も小さい（または最も下回る）分野として多く挙がったのは${weakTally
        .slice(0, 2)
        .map(([k, c]) => `${domainLabel(k)}（${c}都道府県）`)
        .join("と")}です。`
    )
  );
  if (small.length > 0) {
    blocks.push(
      p(
        `駅が4駅以下の${small.length}都道府県（${small.map(([pref, c]) => `${pref}${c}駅`).join("、")}）は、中央値が数駅の値で決まってしまうため表から外しました。各駅の点数は`,
        { html: a("/prefectures", "都道府県から探す") },
        "から見られます。"
      )
    );
  }
  blocks.push(
    readingNotes([
      "対象の駅は、乗降客数の多い駅（おおむね1日1万人以上）と県庁所在地の駅が中心で、各都道府県の駅をまんべんなく選んだものではありません。都市部の駅が多く、都道府県全体の住みやすさを表すものではない点に注意してください。",
      "分野の差は、その都道府県の駅の分野別の平均点から、全国の対象駅の平均点を引いたものです。駅数の少ない都道府県ほど、1駅の値に左右されます。",
      ...COMMON_NOTES,
    ]),
    note(PUBLIC_SOURCE)
  );

  return {
    slug: "prefecture-trends",
    heading: "都道府県ごとの傾向",
    title: "都道府県ごとの駅の住みやすさの傾向｜総合点・地価・強い分野を比較",
    description: `全国${national.count}駅を都道府県ごとにまとめ、住みやすさ駅前スコアの中央値、住宅地の地価、全国平均と比べて強い分野・弱い分野を${groups.length}都道府県で比較しました。`,
    summary: `中央値が最も高いのは${first.pref}（${first.list.length}駅・${fmt1(first.med)}点）、最も低いのは${last.pref}（${last.list.length}駅・${fmt1(last.med)}点）。`,
    html: blocks.join(""),
  };
}

function articleHazard(ctx) {
  const { national } = ctx;
  const H = ctx.B.filter((b) => b.hazard);
  const floodAt = H.filter((b) => b.hazard.flood.at_station);
  const topQ = H.filter((b) => T(b).total >= national.q75);
  const topQFlood = topQ.filter((b) => b.hazard.flood.at_station);
  const none = (b) => HAZARD_KINDS.every((k) => b.hazard[k.key].share_pct === 0);
  const safeGood = dedupeColocated(
    H.filter(none).sort((x, y) => T(y).total - T(x).total),
    15
  );
  const deepGood = dedupeColocated(
    topQ.filter((b) => b.hazard.flood.deep_share_pct >= 50).sort((x, y) => T(y).total - T(x).total),
    15
  );
  const kindCounts = HAZARD_KINDS.map((k) => ({ k, count: H.filter((b) => b.hazard[k.key].share_pct > 0).length }));
  const r = spearman(
    H.map((b) => b.hazard.flood.share_pct),
    H.map((b) => T(b).total)
  );

  const blocks = [
    p(
      "便利な駅に住みたい一方で、水害や土砂災害のおそれがある場所は避けたい、という人は多いはずです。" +
        `全国${H.length}駅について、ハザードマップポータルサイトの想定（洪水・高潮・津波の浸水想定区域と土砂災害警戒区域）を駅から徒歩${WALK}分圏（半径800m）で読み取り、住みやすさ駅前スコアと並べました。`
    ),
    h2("区域がかかる駅はどのくらいあるか"),
    p(
      `駅の地点そのものが洪水浸水想定区域（想定最大規模）に入っている駅は${floodAt.length}駅で、全体の${fmt1(
        (floodAt.length / H.length) * 100
      )}%です。総合点が上位4分の1（${fmt1(national.q75)}点以上）の${topQ.length}駅に限ると${topQFlood.length}駅（${fmt1(
        (topQFlood.length / topQ.length) * 100
      )}%）でした。`
    ),
    table(
      ["種類", `徒歩${WALK}分圏に区域がかかる駅`, "割合"],
      kindCounts.map(({ k, count }) => [k.area, { text: `${count}駅`, num: true }, { text: `${fmt1((count / H.length) * 100)}%`, num: true }])
    ),
    p(
      `洪水浸水想定区域がかかる割合と総合点の順位相関は${fmtR(r)}で、${correlationWords(r)}です。` +
        (r >= 0.4
          ? "施設のそろった駅ほど、浸水想定区域が広くかかっている傾向があります。"
          : r >= 0.2
            ? "弱いながら、施設のそろった駅の方が浸水想定区域が広くかかる傾向が見られます。便利さと水害の想定は、別々に確かめる必要があります。"
            : r <= -0.2
              ? "施設のそろった駅ほど、浸水想定区域が少ない傾向があります。"
            : "住みやすさの点数と洪水の想定は、ほぼ別々に考える必要があります。")
    ),
    h2(`徒歩${WALK}分圏にどの区域もかからない駅（総合点の高い順）`),
    p(
      `洪水・高潮・津波の浸水想定区域と土砂災害警戒区域のどれもが、駅から半径800m以内にかからない駅は${H.filter(none).length}駅でした。そのうち総合点の高い${safeGood.length}駅です。`
    ),
    table(
      ["駅", "都道府県", "総合点", "全国順位"],
      safeGood.map((b) => stationRow(b, [{ text: `${T(b).rank}位`, num: true }]))
    ),
  ];
  if (deepGood.length > 0) {
    blocks.push(
      h2("総合点は高いが、深い浸水が想定されている駅"),
      p(
        `総合点が上位4分の1の駅のうち、徒歩${WALK}分圏の半分以上で3m以上（2階の床まで届く目安）の浸水が想定されている駅です。` +
          "住む階や、避難場所までの道のりを確かめておきたい駅です。"
      ),
      table(
        ["駅", "都道府県", "総合点", "3m以上の割合", "想定される最大の深さ"],
        deepGood.map((b) =>
          stationRow(b, [{ text: `${fmt1(b.hazard.flood.deep_share_pct)}%`, num: true }, DEPTH_LABELS[b.hazard.flood.max]])
        )
      )
    );
  }
  blocks.push(
    h2("想定最大規模とは"),
    p(
      "洪水浸水想定区域の「想定最大規模」は、その川で想定しうる最大の雨（おおむね1000年に1度を上回る程度）が降ったときに浸水する範囲と深さです。" +
        "毎年のように浸水する場所という意味ではありませんが、いざというときに逃げる必要がある範囲を示しています。"
    ),
    readingNotes([...HAZARD_NOTES, "駅ページの「災害リスク」では、種類ごとの割合と駅の地点の想定を見られます。", COMMON_NOTES[0]]),
    note(HAZARD_SOURCE)
  );

  return {
    slug: "hazard-and-livability",
    heading: "浸水想定区域と住みやすさ",
    title: "浸水想定区域と住みやすさ｜ハザードマップの区域がかからない便利な駅",
    description: `全国${H.length}駅で、洪水・高潮・津波の浸水想定区域と土砂災害警戒区域が徒歩10分圏にかかるかを調べ、住みやすさ駅前スコアと比べました。駅の地点が洪水浸水想定区域に入る駅は${floodAt.length}駅。`,
    summary: `駅の地点が洪水浸水想定区域に入る駅は${floodAt.length}駅（${fmt1((floodAt.length / H.length) * 100)}%）。どの区域もかからない駅の1位は${safeGood[0]?.name_ja ?? "該当なし"}。`,
    html: blocks.join(""),
  };
}

function articleDomainBalance(ctx) {
  const { national } = ctx;
  const spreadOf = (b) => {
    const s = DOMAINS.map((d) => T(b).domains[d.key].score);
    return Math.max(...s) - Math.min(...s);
  };
  const uneven = dedupeColocated([...ctx.B].sort((x, y) => spreadOf(y) - spreadOf(x)), 12);
  const topQ = ctx.B.filter((b) => T(b).total >= national.q75);
  const balanced = dedupeColocated([...topQ].sort((x, y) => spreadOf(x) - spreadOf(y)), 12);
  const weakTop = tally(topQ, (b) => weakestDomain(T(b)).key);
  const spreadMed = median(ctx.B.map(spreadOf));

  const blocks = [
    p(
      "総合点が同じでも、6分野がまんべんなく高い駅と、ある分野だけが突出している駅では暮らし方が違います。" +
        `全国${national.count}駅について、6分野の点の最高と最低の差（偏り）を出し、偏りの大きい駅と小さい駅を調べました。全駅の偏りの中央値は${fmt1(spreadMed)}点です。`
    ),
    h2("分野の偏りが大きい駅"),
    p("最も高い分野と最も低い分野の差が大きい駅です。得意な分野が自分の暮らし方に合っていれば、総合点以上に住みやすく感じられるはずです。"),
    table(
      ["駅", "都道府県", "総合点", "最も高い分野", "最も低い分野", "差"],
      uneven.map((b) =>
        stationRow(b, [
          `${domainLabel(strongestDomain(T(b)).key)} ${fmt1(strongestDomain(T(b)).score)}`,
          `${domainLabel(weakestDomain(T(b)).key)} ${fmt1(weakestDomain(T(b)).score)}`,
          { text: fmt1(spreadOf(b)), num: true },
        ])
      )
    ),
    h2("総合点が高い駅の弱点になりやすい分野"),
    p(
      `総合点が上位4分の1（${fmt1(national.q75)}点以上）の${topQ.length}駅で、いちばん低い分野を数えると、${weakTop
        .map(([k, c]) => `${domainLabel(k)}${c}駅`)
        .join("、")}でした。` +
        `便利な駅でも、${domainLabel(weakTop[0][0])}は他の分野ほどそろっていないことが多いと分かります。`
    ),
    h2("総合点が高く、分野の偏りが小さい駅"),
    p("総合点が上位4分の1の駅のうち、6分野の差が小さい駅です。暮らし方を問わず使いやすい駅と言えます。"),
    table(
      ["駅", "都道府県", "総合点", "最も低い分野", "差"],
      balanced.map((b) =>
        stationRow(b, [
          `${domainLabel(weakestDomain(T(b)).key)} ${fmt1(weakestDomain(T(b)).score)}`,
          { text: fmt1(spreadOf(b)), num: true },
        ])
      )
    ),
    p("重視する分野を自分で決めて並べ替えたいときは、", { html: a("/search", "条件で駅を探す") }, "で分野ごとの重視度を選べます。"),
    readingNotes([
      "分野の点は、その分野に入る施設（2〜4種類）の全国での位置の平均です。施設の種類が少ない分野ほど、1種類の有無で点が大きく動きます。",
      ...COMMON_NOTES,
    ]),
  ];

  return {
    slug: "domain-balance",
    heading: "分野の偏りが大きい駅・小さい駅",
    title: "6分野の偏りで見る駅の個性｜得意分野が突出した駅と、まんべんなく高い駅",
    description: `全国${national.count}駅の住みやすさ駅前スコアを6分野の最高と最低の差で比べ、偏りの大きい駅と、総合点が高く偏りの小さい駅を紹介します。`,
    summary: `総合点が上位4分の1の駅で最も多い弱点は${domainLabel(weakTop[0][0])}（${weakTop[0][1]}駅）。偏りが最も大きいのは${uneven[0].name_ja}。`,
    html: blocks.join(""),
  };
}

// 地価が下がった駅の表に出す上限（1,856駅に増やしたら地方の駅で数百駅になるため）
const FALLING_LIMIT = 30;

function articleLandChange(ctx) {
  const L = ctx.B.filter((b) => b.public.land && typeof b.public.land.change_pct === "number");
  const change = (b) => b.public.land.change_pct;
  const r = spearman(L.map(change), L.map((b) => T(b).total));
  const qs = quartiles(L, (b) => T(b).total);
  const qMed = qs.map((q) => median(q.map(change)));
  const rising = dedupeColocated([...L].sort((x, y) => change(y) - change(x)), 15);
  const falling = L.filter((b) => change(b) < 0);
  const year = L[0]?.public.land.year;
  const LABELS = ["総合点の低い4分の1", "やや低い4分の1", "やや高い4分の1", "総合点の高い4分の1"];

  const blocks = [
    p(
      `地価公示（${year}年1月1日時点）の前年比を、駅から徒歩20分以内の住宅地の中央値で出し、全国${L.length}駅の住みやすさ駅前スコアと比べました。` +
        `全駅の前年比の中央値は${signed(median(L.map(change)))}%で、下がった駅は${falling.length}駅でした。`
    ),
    h2("住みやすさと地価の上がり方の関係"),
    p(
      `前年比と総合点の順位相関は${fmtR(r)}で、${correlationWords(r)}があります。` +
        `総合点の低い方から4つに分けると、前年比の中央値は${qMed.map((m) => `${signed(m)}%`).join("→")}です。` +
        (qMed[3] > qMed[0] ? "施設のそろった駅ほど、地価の上がり方も大きい傾向が見られます。" : "")
    ),
    table(
      ["総合点の帯", "駅数", "総合点の範囲", "前年比の中央値"],
      qs.map((q, i) => [
        LABELS[i],
        { text: `${q.length}駅`, num: true },
        { text: `${fmt1(T(q[0]).total)}〜${fmt1(T(q[q.length - 1]).total)}点`, num: true },
        { text: `${signed(qMed[i])}%`, num: true },
      ])
    ),
    h2("地価の上がり方が大きい駅"),
    p(`前年比の大きい${rising.length}駅です。同じ場所の別の事業者の駅は1つにまとめています。`),
    table(
      ["駅", "都道府県", "総合点", "前年比", "住宅地の地価"],
      rising.map((b) =>
        stationRow(b, [{ text: `${signed(change(b))}%`, num: true }, { text: `${formatYenPerM2(landOf(b))}/m²`, num: true }])
      )
    ),
  ];
  if (falling.length > 0) {
    const fallMed = median(falling.map((b) => T(b).total));
    blocks.push(
      h2("地価が下がった駅"),
      p(
        `前年より下がったのは${falling.length}駅で、総合点の中央値は${fmt1(fallMed)}点と、全駅の中央値（${fmt1(
          ctx.national.medianTotal
        )}点）より${fallMed < ctx.national.medianTotal ? "低め" : "高め"}です。` +
          (falling.length > FALLING_LIMIT ? `下がり方の大きい${FALLING_LIMIT}駅を並べます。` : "")
      ),
      table(
        ["駅", "都道府県", "総合点", "前年比"],
        [...falling]
          .sort((x, y) => change(x) - change(y))
          .slice(0, FALLING_LIMIT)
          .map((b) => stationRow(b, [{ text: `${signed(change(b))}%`, num: true }]))
      )
    );
  }
  blocks.push(
    readingNotes([
      "前年比は、駅の周りの住宅地の標準地それぞれの変動率の中央値です。標準地の入れ替えがあると、実際の相場の動きと異なる場合があります。",
      "地価が上がっていることは、住みやすさや将来の値上がりを保証するものではありません。",
      ...COMMON_NOTES,
    ]),
    note(PUBLIC_SOURCE)
  );

  return {
    slug: "land-price-change",
    heading: "地価が上がっている駅と住みやすさ",
    title: `地価が上がっている駅と住みやすさ｜${year}年地価公示の前年比で比較`,
    description: `${year}年の地価公示から全国${L.length}駅の住宅地の地価の前年比を出し、住みやすさ駅前スコアと比べました。順位相関は${fmtR(r)}。上昇率の大きい駅も紹介します。`,
    summary: `前年比の中央値は${signed(median(L.map(change)))}%。総合点との順位相関は${fmtR(r)}。上昇率の1位は${rising[0].name_ja}（${signed(change(rising[0]))}%）。`,
    html: blocks.join(""),
  };
}

const ARTICLES = [
  articleCheapAndConvenient,
  articleRidership,
  articleWalkRange,
  articleHazard,
  articleDomainBalance,
  articlePrefectures,
  articleLandChange,
];

function articlesIndex(articles) {
  return {
    path: "/articles",
    title: "データで見る駅選び｜住みやすさ駅前スコア",
    description: "地価・乗降客数・災害リスク・徒歩圏の広さなど、全国の駅のデータから分かったことをまとめた記事の一覧です。",
    heading: "データで見る駅選び",
    kicker: ARTICLE_KICKER,
    lead: "全国の駅の施設・地価・乗降客数・ハザードマップのデータから分かったことをまとめています。",
    html:
      p(
        "駅ごとのページでは1駅ずつの数字しか見えません。ここでは全国の対象駅をまとめて並べ、地価や乗降客数、災害リスクと住みやすさの関係を調べた結果を記事にしています。数字はデータを更新するたびに計算し直しています。"
      ) +
      `<ul class="doc-cards">${articles
        .map((x) => `<li><a href="${esc(x.path)}"><b>${esc(x.heading)}</b><span>${esc(x.summary)}</span></a></li>`)
        .join("")}</ul>`,
  };
}

// --- まとめて作る -------------------------------------------------------------

export function buildDocs(bundles, stationLines) {
  // 集計は鉄道の駅として確認できた駅だけで行う（importLines.js の rail_stations）。
  // ロッカーアプリ由来の施設名（「イオンモール仙台上杉駅」など）を記事の表に混ぜない
  const rail = new Set(stationLines.rail_stations ?? [...bundles.keys()]);
  // 全国の基準（中央値・上位4分の1）は点数と同じく全掲載駅から出す
  const all = [...bundles.values()].filter((b) => b.tiers[WALK]);
  const B = all.filter((b) => rail.has(b.slug));
  const totals = all.map((b) => T(b).total).sort((x, y) => x - y);
  const national = {
    count: all.length,
    medianTotal: median(totals),
    q75: totals[Math.floor(totals.length * 0.75)],
    domainMeans: Object.fromEntries(DOMAINS.map((d) => [d.key, mean(all.map((b) => T(b).domains[d.key].score))])),
  };
  // 施設数のデータがまだ無い駅（取得に失敗した駅など）は路線から外し、5駅未満になった路線はページを作らない
  const allLines = stationLines.lines
    .map((l) => ({ ...l, stations: l.stations.filter((s) => bundles.has(s)) }))
    .filter((l) => l.stations.length >= 5);
  const ctx = { bundles, B, national, allLines };

  const lines = allLines.map((line) => ({ ...linePage(line, ctx), kind: "line", slug: line.slug }));
  const prefGroups = groupByPrefecture(all).map((g) => ({
    prefecture: g.prefecture,
    rows: [...g.stations].sort((x, y) => T(y).total - T(x).total),
  }));
  const prefs = prefGroups
    .filter((g) => g.rows.length >= PREF_PAGE_MIN)
    .map((g) => ({ ...prefPage(g.prefecture, g.rows, ctx), kind: "pref", slug: prefectureSlug(g.prefecture) }));
  const articles = ARTICLES.map((build) => {
    const doc = build(ctx);
    return { ...doc, kind: "article", path: `/article/${doc.slug}`, kicker: ARTICLE_KICKER, lead: doc.summary };
  });
  const indexes = [
    { ...linesIndex(ctx), kind: "index", slug: "lines" },
    { ...articlesIndex(articles), kind: "index", slug: "articles" },
    { ...prefsIndex(prefGroups, ctx), kind: "index", slug: "prefectures" },
  ];

  // トップページ・駅ページから張るリンク用の目次。
  // ページの無い（駅の少ない）都道府県は page を false にし、一覧（/prefectures#<slug>）へ飛ばす
  const nav = {
    lines: allLines.map((l) => ({ slug: l.slug, name: l.name, count: l.stations.length })),
    articles: articles.map((x) => ({ slug: x.slug, heading: x.heading, summary: x.summary })),
    prefectures: prefGroups.map((g) => ({
      name: g.prefecture,
      slug: prefectureSlug(g.prefecture),
      count: g.rows.length,
      page: g.rows.length >= PREF_PAGE_MIN,
    })),
  };
  return { docs: [...indexes, ...prefs, ...lines, ...articles], nav };
}
