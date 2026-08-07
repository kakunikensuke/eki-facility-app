# 住みやすさ駅前スコア

駅名を選ぶと、周辺（徒歩5/10/15/20分圏内を切り替え可能）のコンビニ・病院・スーパー・飲食店の店舗数がカテゴリ別にわかるWebアプリ。

詳細は[要件定義書.md](./要件定義書.md)・[設計書.md](./設計書.md)・[CLAUDE.md](./CLAUDE.md)参照。

## 使用技術

- フロントエンド: React + Vite + react-router-dom
- バックエンド: Node.js + Express + node-cron
- データ取得元: OpenStreetMap Overpass API（無料・ODbLライセンス）

## セットアップ・起動

### バックエンド

```
cd backend
npm install
npm run dev            # http://localhost:4001
```

### フロントエンド

```
cd frontend
npm install
npm run dev             # http://localhost:5173
```

### 集計バッチの手動実行

Overpass APIから対象駅の店舗数（徒歩5/10/15/20分圏）を再取得し、`backend/data/facility-counts.json`を更新する。

```
cd backend
npm run update:facility-counts
```

349駅すべての取得には約2時間かかる。動作確認だけしたい場合は先頭N駅に絞れる。

```
cd backend
node batch/updateFacilityCounts.js --limit 3
```

定期実行はGitHub Actions（`.github/workflows/update-facility-counts.yml`）に委譲しており、毎日3:00(JST)に走る。無料ホスティングではサーバーのスリープ中にプロセス内cronが発火しないため、バックエンド側では行わない。

### スコアのtarget値を再計算する

集計データからスコアのtarget値（段階別の75パーセンタイル値）を算出する。出力を`backend/scoring.js`と`backend/stationTags.js`に貼り付けて使う。

```
cd backend
node scripts/computeScoreTargets.js
```

## 対象駅

全349駅（23都道府県）。`backend/data/stations.json`参照（`ikebukuro-locker-app`と同じ駅データを流用）。

## ライセンス・出典表示について

店舗数データはOpenStreetMapのOverpass APIから取得している。ODbLライセンスに基づき、画面上に「地図データ: © OpenStreetMap contributors」の出典表示を必須としている（`frontend/src/pages/StationPage.jsx`参照）。
