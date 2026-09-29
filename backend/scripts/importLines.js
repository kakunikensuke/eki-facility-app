/**
 * 駅がどの路線に乗っているかを国土数値情報の駅別乗降客数データ（S12）から調べ、
 * backend/data/station-lines.json に書き出す（2026-09-29追加。路線ごとのページに使う）。
 *
 * S12は「駅×路線」の行を持ち、路線名は正式名（例: 埼京線は「赤羽線」、京浜東北線は「東北線」など）。
 * 正式名のままだと利用者の呼び方と合わないので、ページに出す名前は LINE_META で付け直す。
 * LINE_META に無い路線はページを作らない（名前を機械的に作ると呼び方が間違ったページができる）。
 *
 * 路線に載せる駅の決め方:
 * - S12の駅名と、このサイトの駅名（「東急 渋谷駅」なら「渋谷」）が一致すること
 * - 事業者名の付いた駅（「東急 渋谷駅」「Osaka Metro 梅田駅」）は、その事業者の路線にだけ載せる
 * - 同じ路線に同じ駅が2つ載る（「渋谷駅」と「東急 渋谷駅」）ときは、事業者名が合う方を残す
 * - このサイトで扱っている駅が MIN_STATIONS 駅以上ある路線だけページにする
 *
 * 実行: node backend/scripts/importLines.js <S12のGeoJSON>
 */

const fs = require("fs");
const path = require("path");

const [, , s12Path] = process.argv;
if (!s12Path) {
  console.error("使い方: node backend/scripts/importLines.js <S12のGeoJSON>");
  process.exit(1);
}

const STATIONS_PATH = path.join(__dirname, "..", "data", "stations.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "station-lines.json");
const MATCH_KM = 1.0;
const MIN_STATIONS = 5;

// 駅名に付いている事業者名 → S12の事業者名
const PREFIX_OPERATOR = {
  京王: "京王電鉄",
  京阪: "京阪電気鉄道",
  阪急: "阪急電鉄",
  阪神: "阪神電気鉄道",
  東急: "東急電鉄",
  西武: "西武鉄道",
  東武: "東武鉄道",
  小田急: "小田急電鉄",
  京急: "京浜急行電鉄",
  京成: "京成電鉄",
  南海: "南海電気鉄道",
  近鉄: "近畿日本鉄道",
  "Osaka Metro": "大阪市高速電気軌道",
  横浜市営地下鉄: "横浜市",
  札幌市営: "札幌市",
  東京モノレール: "東京モノレール",
};

// ページにする路線。key は「S12の事業者名|S12の路線名」。
// name は利用者の呼び方、note は正式名と呼び方がずれているときの説明（ページに出す）
const LINE_META = {
  "東日本旅客鉄道|山手線": { slug: "jr-yamanote", name: "JR山手線" },
  "東日本旅客鉄道|中央線": {
    slug: "jr-chuo",
    name: "JR中央線",
    note: "正式な路線名の「中央本線」でまとめています。中央線快速と、御茶ノ水〜三鷹の中央・総武線各駅停車、高尾より西の区間を含みます。",
  },
  "東日本旅客鉄道|東北線": {
    slug: "jr-tohoku",
    name: "JR東北本線（京浜東北線・宇都宮線）",
    note: "正式な路線名の「東北本線」でまとめています。東京〜大宮の京浜東北線、宇都宮線、東北地方の東北本線を含みます。",
  },
  "東日本旅客鉄道|東海道線": {
    slug: "jr-tokaido",
    name: "JR東海道本線（東海道線・京浜東北線）",
    note: "正式な路線名の「東海道本線」のうち、JR東日本が運行する東京〜熱海の区間です。東京〜横浜の京浜東北線の区間を含みます。静岡・愛知・岐阜の区間と関西の区間は別のページにしています。",
  },
  "東日本旅客鉄道|総武線": {
    slug: "jr-sobu",
    name: "JR総武本線（総武線各駅停車・快速）",
    note: "正式な路線名の「総武本線」でまとめています。",
  },
  "東日本旅客鉄道|武蔵野線": { slug: "jr-musashino", name: "JR武蔵野線" },
  "東日本旅客鉄道|常磐線": { slug: "jr-joban", name: "JR常磐線" },
  "東日本旅客鉄道|横浜線": { slug: "jr-yokohama", name: "JR横浜線" },
  "東日本旅客鉄道|南武線": { slug: "jr-nambu", name: "JR南武線" },
  "東日本旅客鉄道|京葉線": { slug: "jr-keiyo", name: "JR京葉線" },
  "東日本旅客鉄道|根岸線": { slug: "jr-negishi", name: "JR根岸線" },
  "東日本旅客鉄道|高崎線": { slug: "jr-takasaki", name: "JR高崎線" },
  "東日本旅客鉄道|青梅線": { slug: "jr-ome", name: "JR青梅線" },
  "東日本旅客鉄道|横須賀線": { slug: "jr-yokosuka", name: "JR横須賀線" },
  "東日本旅客鉄道|奥羽線": { slug: "jr-ou", name: "JR奥羽本線" },
  "大阪市高速電気軌道|1号線(御堂筋線)": { slug: "osaka-metro-midosuji", name: "Osaka Metro御堂筋線" },
  "大阪市高速電気軌道|2号線(谷町線)": { slug: "osaka-metro-tanimachi", name: "Osaka Metro谷町線" },
  "大阪市高速電気軌道|7号線(長堀鶴見緑地線)": {
    slug: "osaka-metro-nagahori-tsurumi-ryokuchi",
    name: "Osaka Metro長堀鶴見緑地線",
  },
  "大阪市高速電気軌道|6号線(堺筋線)": { slug: "osaka-metro-sakaisuji", name: "Osaka Metro堺筋線" },
  "京阪電気鉄道|京阪本線": { slug: "keihan-main", name: "京阪本線" },
  "東京地下鉄|4号線丸ノ内線": { slug: "tokyo-metro-marunouchi", name: "東京メトロ丸ノ内線" },
  "東京地下鉄|2号線日比谷線": { slug: "tokyo-metro-hibiya", name: "東京メトロ日比谷線" },
  "東京地下鉄|7号線南北線": { slug: "tokyo-metro-namboku", name: "東京メトロ南北線" },
  "東京地下鉄|3号線銀座線": { slug: "tokyo-metro-ginza", name: "東京メトロ銀座線" },
  "東京地下鉄|5号線東西線": { slug: "tokyo-metro-tozai", name: "東京メトロ東西線" },
  "東京地下鉄|8号線有楽町線": { slug: "tokyo-metro-yurakucho", name: "東京メトロ有楽町線" },
  "東急電鉄|東横線": { slug: "tokyu-toyoko", name: "東急東横線" },
  "東急電鉄|田園都市線": { slug: "tokyu-denentoshi", name: "東急田園都市線" },
  "京王電鉄|京王線": { slug: "keio", name: "京王線" },
  "東京都|12号線大江戸線": { slug: "toei-oedo", name: "都営大江戸線" },
  "東京都|10号線新宿線": { slug: "toei-shinjuku", name: "都営新宿線" },
  "横浜市|3号線": {
    slug: "yokohama-blue",
    name: "横浜市営地下鉄ブルーライン（関内〜あざみ野）",
    note: "ブルーラインの関内〜あざみ野（正式には3号線）です。湘南台〜関内（1号線）は別のページにしています。",
  },
  "小田急電鉄|小田原線": { slug: "odakyu-odawara", name: "小田急小田原線" },
  "東日本旅客鉄道|赤羽線": {
    slug: "jr-akabane",
    name: "JR埼京線（赤羽線）",
    note: "正式な路線名の「赤羽線」（池袋〜赤羽）でまとめています。赤羽より北の埼京線の区間は「東北本線」に入ります。",
  },

  // --- 2026-09-30、掲載駅を全国1,856駅に広げたときに追加 ---
  // 首都圏
  "東日本旅客鉄道|川越線": {
    slug: "jr-kawagoe",
    name: "JR川越線",
    note: "大宮〜川越は埼京線の電車が直通しています。",
  },
  "東日本旅客鉄道|外房線": { slug: "jr-sotobo", name: "JR外房線" },
  "東日本旅客鉄道|内房線": { slug: "jr-uchibo", name: "JR内房線" },
  "東日本旅客鉄道|成田線": { slug: "jr-narita", name: "JR成田線" },
  "東日本旅客鉄道|相模線": { slug: "jr-sagami", name: "JR相模線" },
  "東日本旅客鉄道|両毛線": { slug: "jr-ryomo", name: "JR両毛線" },
  "東日本旅客鉄道|信越線": { slug: "jr-shinetsu", name: "JR信越本線" },
  "東日本旅客鉄道|仙石線": { slug: "jr-senseki", name: "JR仙石線" },
  "東京地下鉄|9号線千代田線": { slug: "tokyo-metro-chiyoda", name: "東京メトロ千代田線" },
  "東京地下鉄|11号線半蔵門線": { slug: "tokyo-metro-hanzomon", name: "東京メトロ半蔵門線" },
  "東京地下鉄|13号線副都心線": { slug: "tokyo-metro-fukutoshin", name: "東京メトロ副都心線" },
  "東京都|1号線浅草線": { slug: "toei-asakusa", name: "都営浅草線" },
  "東京都|6号線三田線": { slug: "toei-mita", name: "都営三田線" },
  "東京都|日暮里・舎人ライナー": { slug: "nippori-toneri-liner", name: "日暮里・舎人ライナー" },
  "西武鉄道|池袋線": { slug: "seibu-ikebukuro", name: "西武池袋線" },
  "西武鉄道|新宿線": { slug: "seibu-shinjuku", name: "西武新宿線" },
  "西武鉄道|拝島線": { slug: "seibu-haijima", name: "西武拝島線" },
  "西武鉄道|国分寺線": { slug: "seibu-kokubunji", name: "西武国分寺線" },
  "東武鉄道|東上本線": { slug: "tobu-tojo", name: "東武東上線" },
  "東武鉄道|伊勢崎線": {
    slug: "tobu-isesaki",
    name: "東武伊勢崎線（東武スカイツリーライン）",
    note: "正式な路線名の「伊勢崎線」でまとめています。浅草・押上〜東武動物公園の東武スカイツリーラインの区間を含みます。",
  },
  "東武鉄道|野田線": { slug: "tobu-noda", name: "東武アーバンパークライン（野田線）" },
  "京王電鉄|井の頭線": { slug: "keio-inokashira", name: "京王井の頭線" },
  "京王電鉄|相模原線": { slug: "keio-sagamihara", name: "京王相模原線" },
  "小田急電鉄|江ノ島線": { slug: "odakyu-enoshima", name: "小田急江ノ島線" },
  "東急電鉄|目黒線": { slug: "tokyu-meguro", name: "東急目黒線" },
  "東急電鉄|大井町線": { slug: "tokyu-oimachi", name: "東急大井町線" },
  "東急電鉄|池上線": { slug: "tokyu-ikegami", name: "東急池上線" },
  "東急電鉄|東急多摩川線": { slug: "tokyu-tamagawa", name: "東急多摩川線" },
  "京浜急行電鉄|本線": { slug: "keikyu-main", name: "京急本線" },
  "京浜急行電鉄|空港線": { slug: "keikyu-airport", name: "京急空港線" },
  "京浜急行電鉄|大師線": { slug: "keikyu-daishi", name: "京急大師線" },
  "京浜急行電鉄|久里浜線": { slug: "keikyu-kurihama", name: "京急久里浜線" },
  "京成電鉄|本線": { slug: "keisei-main", name: "京成本線" },
  "京成電鉄|押上線": { slug: "keisei-oshiage", name: "京成押上線" },
  "京成電鉄|成田空港線": { slug: "keisei-narita-sky-access", name: "京成成田空港線（成田スカイアクセス線）" },
  "新京成電鉄|新京成線": {
    slug: "keisei-matsudo",
    name: "京成松戸線（旧・新京成線）",
    note: "2025年4月に新京成電鉄が京成電鉄に合併し、新京成線は京成松戸線になりました。データの元になった国土数値情報では旧名で載っています。",
  },
  "北総鉄道|北総線": { slug: "hokuso", name: "北総線" },
  "東葉高速鉄道|東葉高速線": { slug: "toyo-rapid", name: "東葉高速線" },
  "首都圏新都市鉄道|常磐新線": {
    slug: "tsukuba-express",
    name: "つくばエクスプレス",
    note: "正式な路線名は「常磐新線」です。",
  },
  "埼玉高速鉄道|埼玉高速鉄道線": { slug: "saitama-railway", name: "埼玉高速鉄道線（埼玉スタジアム線）" },
  "相模鉄道|相鉄本線": { slug: "sotetsu-main", name: "相鉄本線" },
  "相模鉄道|相鉄いずみ野線": { slug: "sotetsu-izumino", name: "相鉄いずみ野線" },
  "横浜高速鉄道|みなとみらい21線": { slug: "minatomirai", name: "みなとみらい線" },
  "横浜市|1号線": {
    slug: "yokohama-blue-south",
    name: "横浜市営地下鉄ブルーライン（湘南台〜関内）",
    note: "ブルーラインの湘南台〜関内（正式には1号線）です。関内〜あざみ野（3号線）は別のページにしています。",
  },
  "横浜市|4号線": { slug: "yokohama-green", name: "横浜市営地下鉄グリーンライン" },
  "ゆりかもめ|東京臨海新交通臨海線": { slug: "yurikamome", name: "ゆりかもめ" },
  "東京臨海高速鉄道|臨海副都心線": { slug: "rinkai", name: "りんかい線" },
  "東京モノレール|東京モノレール羽田空港線": { slug: "tokyo-monorail", name: "東京モノレール" },
  "多摩都市モノレール|多摩都市モノレール線": { slug: "tama-monorail", name: "多摩モノレール" },
  // 東海
  "東海旅客鉄道|東海道線": {
    slug: "jr-central-tokaido",
    name: "JR東海道本線（静岡・愛知・岐阜）",
    note: "JR東海が運行する熱海〜米原の区間です。首都圏の区間と関西の区間は別のページにしています。",
  },
  "東海旅客鉄道|中央線": {
    slug: "jr-central-chuo",
    name: "JR中央本線（名古屋〜中津川など）",
    note: "JR東海が運行する区間です。首都圏の中央線は別のページにしています。",
  },
  "名古屋市|1号線東山線": { slug: "nagoya-higashiyama", name: "名古屋市営地下鉄東山線" },
  "名古屋市|2号線名城線": {
    slug: "nagoya-meijo-2",
    name: "名古屋市営地下鉄名城線（大曽根〜栄〜金山）",
    note: "環状の名城線のうち、正式には2号線にあたる区間です。残りの区間は別のページにしています。",
  },
  "名古屋市|4号線名城線": {
    slug: "nagoya-meijo-4",
    name: "名古屋市営地下鉄名城線（金山〜八事〜大曽根）",
    note: "環状の名城線のうち、正式には4号線にあたる区間です。残りの区間は別のページにしています。",
  },
  "名古屋市|2号線名港線": { slug: "nagoya-meiko", name: "名古屋市営地下鉄名港線" },
  "名古屋市|3号線鶴舞線": { slug: "nagoya-tsurumai", name: "名古屋市営地下鉄鶴舞線" },
  "名古屋市|6号線桜通線": { slug: "nagoya-sakuradori", name: "名古屋市営地下鉄桜通線" },
  "名古屋鉄道|名古屋本線": { slug: "meitetsu-nagoya-main", name: "名鉄名古屋本線" },
  "名古屋鉄道|犬山線": { slug: "meitetsu-inuyama", name: "名鉄犬山線" },
  "近畿日本鉄道|名古屋線": { slug: "kintetsu-nagoya", name: "近鉄名古屋線" },
  // 近畿
  "西日本旅客鉄道|東海道線": {
    slug: "jr-west-tokaido",
    name: "JR東海道本線（JR京都線・JR神戸線・琵琶湖線）",
    note: "正式な路線名の「東海道本線」でまとめています。米原〜京都の琵琶湖線、京都〜大阪のJR京都線、大阪〜神戸のJR神戸線を含みます。",
  },
  "西日本旅客鉄道|山陽線": {
    slug: "jr-sanyo",
    name: "JR山陽本線（JR神戸線など）",
    note: "正式な路線名の「山陽本線」でまとめています。神戸〜姫路のJR神戸線と、岡山・広島・山口県内の区間を含みます。",
  },
  "西日本旅客鉄道|大阪環状線": { slug: "jr-osaka-loop", name: "JR大阪環状線" },
  "西日本旅客鉄道|片町線": {
    slug: "jr-gakkentoshi",
    name: "JR学研都市線（片町線）",
    note: "正式な路線名は「片町線」です。",
  },
  "西日本旅客鉄道|福知山線": {
    slug: "jr-takarazuka",
    name: "JR宝塚線（福知山線）",
    note: "正式な路線名の「福知山線」でまとめています。",
  },
  "西日本旅客鉄道|関西線": {
    slug: "jr-kansai",
    name: "JR関西本線（大和路線など）",
    note: "正式な路線名の「関西本線」でまとめています。JR難波〜加茂の大和路線の区間を含みます。",
  },
  "西日本旅客鉄道|阪和線": { slug: "jr-hanwa", name: "JR阪和線" },
  "西日本旅客鉄道|奈良線": { slug: "jr-nara", name: "JR奈良線" },
  "西日本旅客鉄道|湖西線": { slug: "jr-kosei", name: "JR湖西線" },
  "西日本旅客鉄道|山陰線": {
    slug: "jr-sanin",
    name: "JR山陰本線（嵯峨野線など）",
    note: "正式な路線名の「山陰本線」でまとめています。京都〜園部の嵯峨野線の区間を含みます。",
  },
  "西日本旅客鉄道|おおさか東線": { slug: "jr-osaka-higashi", name: "JRおおさか東線" },
  "西日本旅客鉄道|JR東西線": { slug: "jr-tozai", name: "JR東西線" },
  "大阪市高速電気軌道|3号線(四つ橋線)": { slug: "osaka-metro-yotsubashi", name: "Osaka Metro四つ橋線" },
  "大阪市高速電気軌道|4号線(中央線)": { slug: "osaka-metro-chuo", name: "Osaka Metro中央線" },
  "大阪市高速電気軌道|5号線(千日前線)": { slug: "osaka-metro-sennichimae", name: "Osaka Metro千日前線" },
  "大阪市高速電気軌道|8号線(今里筋線)": { slug: "osaka-metro-imazatosuji", name: "Osaka Metro今里筋線" },
  "北大阪急行電鉄|南北線": { slug: "kitakyu", name: "北大阪急行線" },
  "大阪モノレール|大阪モノレール線": { slug: "osaka-monorail", name: "大阪モノレール" },
  "阪急電鉄|神戸線": { slug: "hankyu-kobe", name: "阪急神戸線" },
  "阪急電鉄|宝塚線": { slug: "hankyu-takarazuka", name: "阪急宝塚線" },
  "阪急電鉄|京都線": { slug: "hankyu-kyoto", name: "阪急京都線" },
  "阪急電鉄|千里線": { slug: "hankyu-senri", name: "阪急千里線" },
  "阪急電鉄|今津線": { slug: "hankyu-imazu", name: "阪急今津線" },
  "阪神電気鉄道|本線": { slug: "hanshin-main", name: "阪神本線" },
  "阪神電気鉄道|阪神なんば線": { slug: "hanshin-namba", name: "阪神なんば線" },
  "南海電気鉄道|南海本線": { slug: "nankai-main", name: "南海本線" },
  "南海電気鉄道|高野線": { slug: "nankai-koya", name: "南海高野線" },
  "泉北高速鉄道|泉北高速鉄道線": {
    slug: "nankai-semboku",
    name: "南海泉北線（旧・泉北高速鉄道線）",
    note: "2025年4月に泉北高速鉄道が南海電気鉄道に合併し、南海泉北線になりました。データの元になった国土数値情報では旧名で載っています。",
  },
  "近畿日本鉄道|大阪線": { slug: "kintetsu-osaka", name: "近鉄大阪線" },
  "近畿日本鉄道|奈良線": { slug: "kintetsu-nara", name: "近鉄奈良線" },
  "近畿日本鉄道|京都線": { slug: "kintetsu-kyoto", name: "近鉄京都線" },
  "近畿日本鉄道|橿原線": { slug: "kintetsu-kashihara", name: "近鉄橿原線" },
  "近畿日本鉄道|南大阪線": { slug: "kintetsu-minami-osaka", name: "近鉄南大阪線" },
  "近畿日本鉄道|けいはんな線": { slug: "kintetsu-keihanna", name: "近鉄けいはんな線" },
  "京都市|烏丸線": { slug: "kyoto-karasuma", name: "京都市営地下鉄烏丸線" },
  "京都市|東西線": { slug: "kyoto-tozai", name: "京都市営地下鉄東西線" },
  // 北海道・東北・九州
  "北海道旅客鉄道|函館線": { slug: "jr-hakodate", name: "JR函館本線" },
  "札幌市|南北線": { slug: "sapporo-namboku", name: "札幌市営地下鉄南北線" },
  "札幌市|東西線": { slug: "sapporo-tozai", name: "札幌市営地下鉄東西線" },
  "札幌市|東豊線": { slug: "sapporo-toho", name: "札幌市営地下鉄東豊線" },
  "仙台市|南北線": { slug: "sendai-namboku", name: "仙台市地下鉄南北線" },
  "九州旅客鉄道|鹿児島線": { slug: "jr-kagoshima", name: "JR鹿児島本線" },
  "九州旅客鉄道|日豊線": { slug: "jr-nippo", name: "JR日豊本線" },
  "福岡市|1号線(空港線)": { slug: "fukuoka-kuko", name: "福岡市地下鉄空港線" },
  "福岡市|3号線(七隈線)": { slug: "fukuoka-nanakuma", name: "福岡市地下鉄七隈線" },
  "西日本鉄道|天神大牟田線": { slug: "nishitetsu-tenjin-omuta", name: "西鉄天神大牟田線" },
};

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// 全角・半角の揺れ（「･」と「・」など）もそろえる
// 「祗」と「祇」も同じ字とみなす（S12は「下祗園」、駅名は「下祇園」）
const normalize = (name) => name.normalize("NFKC").replace(/ヶ/g, "ケ").replace(/ヵ/g, "カ").replace(/祗/g, "祇");

// このサイトの駅名とS12の駅名が違う実在の駅（S12側の表記）
const NAME_ALIASES = { 関西国際空港: "関西空港", 大阪国際空港: "大阪空港", なんば: "難波" };

// 「東急 渋谷駅」→ { prefix: "東急", names: ["渋谷"] }、「京王府中駅」→ { prefix: "京王", names: ["京王府中", "府中"] }
function parseName(fullName) {
  // 同名の駅を区別する括弧書き（「尼崎駅（阪神）」「今里駅（Osaka Metro）」）は比べる前に外す
  const nameJa = fullName.replace(/（[^）]*）$/, "");
  const lastSpace = nameJa.lastIndexOf(" ");
  let prefix = lastSpace > 0 ? nameJa.slice(0, lastSpace) : null;
  const base = nameJa.slice(lastSpace + 1).replace(/(駅|停留場)$/, "");
  const names = [base];
  if (NAME_ALIASES[base]) names.push(NAME_ALIASES[base]);
  for (const p of Object.keys(PREFIX_OPERATOR)) {
    if (!prefix && base.startsWith(p) && base.length > p.length) {
      prefix = p;
      names.push(base.slice(p.length));
    }
  }
  return { prefix, names: names.map(normalize) };
}

const stations = JSON.parse(fs.readFileSync(STATIONS_PATH, "utf-8"));
const rows = JSON.parse(fs.readFileSync(s12Path, "utf-8")).features.map((f) => {
  const p = f.properties;
  const c = f.geometry.coordinates;
  const [lon, lat] = c[Math.floor(c.length / 2)];
  return { name: normalize(p.S12_001), operator: p.S12_002, line: p.S12_003, lat, lon };
});

// 路線ごとに載る駅（重複除去の前）
const byLine = new Map();
// S12に同じ名前の駅が見つかった駅。見つからないものはロッカーアプリ由来の施設名
// （「イオンモール仙台上杉駅」など、鉄道の駅ではない掲載）で、路線ページや記事の集計から外す
const railStations = [];
const notRail = [];
for (const station of stations) {
  const { prefix, names } = parseName(station.name_ja);
  const operator = prefix ? PREFIX_OPERATOR[prefix] : null;
  const hits = rows.filter(
    (r) =>
      names.includes(r.name) &&
      (!operator || r.operator === operator) &&
      distanceKm(station, r) <= MATCH_KM
  );
  if (hits.length > 0) railStations.push(station.slug);
  else notRail.push(station.name_ja);
  for (const r of hits) {
    const key = `${r.operator}|${r.line}`;
    if (!byLine.has(key)) byLine.set(key, new Map());
    const list = byLine.get(key);
    // 同じ路線の同じ駅（S12の駅名が同じ）に2駅が当たったら、事業者名が合う方を残す
    const prev = list.get(r.name);
    if (!prev || (operator && !prev.operator)) list.set(r.name, { slug: station.slug, operator });
  }
}

const lines = [];
const skipped = [];
for (const [key, list] of byLine) {
  const slugs = [...list.values()].map((v) => v.slug);
  if (slugs.length < MIN_STATIONS) continue;
  const meta = LINE_META[key];
  if (!meta) {
    skipped.push(`${key}（${slugs.length}駅）`);
    continue;
  }
  const [operator, official] = key.split("|");
  lines.push({ slug: meta.slug, name: meta.name, operator, official, note: meta.note ?? null, stations: slugs });
}
lines.sort((a, b) => b.stations.length - a.stations.length);

const stationLines = {};
for (const line of lines) {
  for (const slug of line.stations) (stationLines[slug] ??= []).push(line.slug);
}

fs.writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(
    {
      source: "国土数値情報（駅別乗降客数データ）国土交通省 / CC BY 4.0",
      source_file: path.basename(s12Path),
      lines,
      station_lines: stationLines,
      rail_stations: railStations,
    },
    null,
    2
  ) + "\n"
);
console.log(`station-lines.json を書き出しました（${lines.length}路線、駅として確認できた駅 ${railStations.length}/${stations.length}）`);
console.log(`S12に同名の駅が無い: ${notRail.join("、")}`);
if (skipped.length > 0) console.log(`名前の定義が無いので作らなかった路線: ${skipped.join("、")}`);
