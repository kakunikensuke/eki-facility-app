# 住みやすさ駅前スコア（eki-facility-app）

駅名を入力すると周辺（徒歩5/10/15/20分圏内）のコンビニ・病院・スーパー・飲食店の店舗数がカテゴリ別にわかるアプリ。詳細は[要件定義書.md](./要件定義書.md)・[設計書.md](./設計書.md)参照。

## AdSenseと静的HTMLの鉄則（2回不承認になっている）

このアプリは「有用性の低いコンテンツ」で**2回**不承認になっており、原因は2回とも同じ形だった。
**React側には書いてあるのに、プリレンダした静的HTMLには出ていない。** JSを実行しない
クローラや審査ボットからは、存在しないのと同じになる。

- 1回目（2026-08-08）: `/guide`・`/privacy` の本文がJSXに直書きで、静的HTMLの本文が48文字
- 2回目（2026-08-22）: `components/Footer.jsx` のリンクが静的HTMLに1本も出ておらず、
  **駅ページ349枚（サイトの98%）から運営者情報・プライバシーポリシーへ到達できなかった。**
  1回目の対策でそれらのページの本文は充実させたが、そこへの経路を作らなかったため
  審査で読まれていなかったとみられる

したがって以下を守ること。

- **画面に足したものは、必ずプリレンダにも足す。** 本文は `src/content/pages.js`、
  フッターは `components/Footer.jsx` と `scripts/prerender.js` の `siteFooterHtml` が
  対になっている。片方だけ直すと「画面には出ているのにクローラには見えない」状態が生まれる
- **`npm run build` が生成物を自己点検してビルドを落とす**（`scripts/prerender.js` の
  `verifyOutput`）。全ページのフッター・`/about``/privacy``/contact` へのリンク・
  OpenStreetMapの出典表示・contactフォームの存在を検証する。**このチェックを外さないこと**
- **お問い合わせフォームは `/contact` の1ページに集約する。** 複数ページに同じフォームを
  置くと重複コンテンツになり、独立したページが無いと審査ボットが問い合わせ手段を見つけられない
- **送信完了ページ（`/contact-received`）は noindex にし、sitemapにも載せない。**
  検索から直接来ても意味がないページを検索対象に差し出すと、それ自体が薄いページとして数えられる
  （`pageMeta.js` の `noindex` / `hideFromNav` フラグ）
- **審査が終わるまで「広告枠（準備中）」のダミーを置かない。** 承認後に
  `components/AdSlot.jsx` を実タグに差し替えて `StationPage.jsx` に戻す

## 2026-09-29の全面改造（スコア・デザイン・写真・公的データ）

ユーザーの依頼「ださい・スコアの要素が足りない」を受けて作り直した。**旧スコア（4カテゴリ・100点満点・target方式）はもう使っていない。**

- **スコア**: `backend/livability.js` が唯一の採点。19種類の施設 → 6分野（買い物・食事・医療・子育て/教育・生活/安全・自然/余暇）。施設ごとに全国パーセンタイル → 分野の平均（0〜100）→ 総合＝6分野の平均（0〜100、小数1桁。公開当初の1000点満点は同日に100点満点へ変更）。相対評価なので駅の増減で点が動く（頭打ちで順位が機能しない方を重く見た判断）。画面用の定義は `frontend/src/livabilityDefs.js` に複製し、ずれたらビルドが止まる（`stationBundle.js` の `assertDefsInSync`）
- **表示データ**: `frontend/scripts/stationBundle.js` が駅ごとの一式を作り、`generateApiData.js`（JSON）と `prerender.js`（静的HTML）の**両方が同じ物を使う**。文章は `src/stationProfileText.js` にだけ置く
- **施設の集計**: `backend/batch/updateFacilityCounts.js` は18カテゴリを1600m圏で1回に取り（キーごとに正規表現でまとめる）、距離は手元で数える。`restaurant` はカフェを含む従来の定義のまま、採点は `restaurant_only`（カフェを除く）。全駅を手元で取り直すときは `OVERPASS_ENDPOINT=https://maps.mail.ru/osm/tools/overpass/api/interpreter` と `--part k/n --out` で並行に流し、`backend/scripts/mergeFacilityCounts.js` でまとめる（公開サーバー1本だと429で1駅1分かかる）
- **地価・乗降客数**: `backend/scripts/importPublicData.js` が国土数値情報（L01地価公示・S12駅別乗降客数、CC BY 4.0）から `backend/data/station-public.json` を作る。元データはリポジトリに入れない。**年1回手動で更新**。点数には混ぜず並べて見せる。出典表示が必要（駅ページ・比較・使い方・運営者情報に記載済み）
- **写真**: `backend/scripts/fetchStationPhotos.js` が日本語版Wikipediaの駅記事の写真（Wikimedia Commons）を機械的に選んで `backend/data/station-photos.json` に保存。**目視確認はしない方針**（ユーザー指定）なので、混ざってはいけない写真はファイル名・説明文の除外語（`EXCLUDE`）で落とす。画像はWikimediaのサムネイルを直接読む。**撮影者とライセンスの表示を消さないこと**（CC BYの条件。ヒーロー右下と駅ページ下部）
- **デザイン**: `src/design.css`（App.cssの後に読む）。写真のスライドは `components/PhotoHero.jsx`。フォントはGoogle Fonts（Zen Kaku Gothic New / Outfit）で、プライバシーポリシーに記載済み
- `backend/server.js` と `backend/scoring.js`・`backend/stationTags.js` は旧スコアのまま残っている（本番では使っていない）

## 条件検索・目的別ランキング・似ている駅（2026-09-29追加）

4回目の不承認（9/15）を受けて、見た目の手直しより先に「駅名を知らない人が使える機能」を足した。

- `/search`（`pages/SearchPage.jsx`）: 徒歩段階・都道府県・7カテゴリの最低軒数で絞り、目的別または項目ごとの重視度で並べる。条件はURLのクエリに持つ
- 並び順は**カテゴリごとの全国パーセンタイルの重み付き平均**（`src/stationSearch.js`）。スコアは100点で頭打ちになり上位の駅に差がつかないため使わない
- データは `/api/station-matrix.json`（`scripts/stationMatrix.js`。全駅×4段階×7カテゴリ）。プリレンダも同じ表から目的別の上位駅を組む
- 似ている駅は `backend/stationSimilarity.js`（log＋標準化した7カテゴリの距離。1.6km以内と同じ場所の別事業者の駅は除く）
- 駅の `kana`・`prefecture` は `backend/data/stations.json` にある（ロッカーアプリの駅データから転記）
- 駅ページの一言コメント（`stationComment.js`）は、駅名ハッシュで言い回しを選ぶ方式をやめた。**言い回しの入れ替えで駅ごとの差を作らないこと**（テンプレート量産に当たる）

## 残っている作業

- **Googleフォーム本体の削除**（ユーザー作業）。サイト内フォームへの移行自体は2026-08-15に完了済み（`858fa4a`）だが、Googleフォームはロッカーアプリ（`ikebukuro-locker-app`）と共用しているため、**ロッカーアプリ側の移行が終わるまで消さないこと**。手順は[お問い合わせフォーム移行_引き継ぎ.md](./お問い合わせフォーム移行_引き継ぎ.md)の§6

## 技術スタック（2026-07-16確定）

- フロントエンド: React + Vite（ロッカーアプリ`ikebukuro-locker-app`と共通、ノウハウ再利用のため）
- バックエンド: Node.js + Express
- データ取得元: OpenStreetMap Overpass API（無料・商用利用可、ODbLライセンスにより出典表示必須）
- データ保存: JSONファイル（`backend/data/stations.json`, `backend/data/facility-counts.json`）
- 地図表示ライブラリは導入しない（MVPは店舗数の数値表示のみが対象、地図・店舗一覧表示は将来拡張候補）

## 集計方式

ユーザーの検索リクエストのたびにOverpass APIを叩くのではなく、**バッチで事前集計しJSONにキャッシュ**し、APIはキャッシュを返すだけにする（Overpass APIのレート制限対策、ロッカーアプリの`updateLockers.js`と同じ設計思想）。バッチ本体は`backend/batch/updateFacilityCounts.js`。

## 確定済みパラメータ

- 集計範囲: **徒歩5/10/15/20分の4段階**（半径400/800/1200/1600m、`半径=徒歩分数×80m/分`で換算）。2026-08-07に徒歩10分のみから拡張。既定の表示段階は徒歩10分（`frontend/src/walkTiers.js`の`DEFAULT_WALK_MINUTES`）。4段階は1回のOverpassクエリでまとめて取得しており、リクエスト数は段階を増やしても駅あたり1回のまま
- 対象駅: 初期は池袋・新宿・渋谷・東京・品川・上野・横浜の7駅（ロッカーアプリと同じ）。**2026-07-17、ロッカーアプリの349駅（23都道府県）全件に拡大**（座標データ流用）。目的は住みやすさスコアのtarget値を実データ分布から決め直すこと（下記参照）。
- カテゴリ範囲: 病院はクリニック含む、飲食店はカフェ・ファストフード含む
- 追加カテゴリ（2026-07-16追加）: ドラッグストア・公園・保育園/幼稚園（OSMで区別できないため統合）。**2026-09-29からは他の施設と同じく採点に含む**（上の「全面改造」参照）
- ~~住みやすさスコアのtarget値（75パーセンタイルで満点）~~ **2026-09-29に廃止**。今の採点は backend/livability.js（全国パーセンタイル方式、100点満点）。旧方式は約1割の駅が100点で並び順位が機能しなかった

## プラットフォーム方針

- **当面はWEBアプリのみでリリースし、iOSアプリ化は保留する。**
- 理由: 収益化モデル（広告＋アフィリエイト）は「駅名×カテゴリ」の検索キーワードからのSEO流入を軸にするため、インストールが必要なiOSよりWebの方が効率的。ロッカーアプリと同じ判断。
- ルートCLAUDE.mdの「Web版とiOS版でコア機能・仕様の整合性を保つ」方針は、iOS版着手まで本プロジェクトでは一時適用対象外とする。

## ライセンス・法務上の注意

- OpenStreetMapのデータ利用条件（ODbL）に基づき、**全ページに「地図データ: © OpenStreetMap contributors」の出典表示が必須**。
- Overpass APIは無料の共同利用インフラのため、fair use policyに従い過度なリクエスト頻度を避ける（バッチ実行時のインターバル、User-Agent明示等）。
