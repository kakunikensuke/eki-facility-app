import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="not-found">
      <h1>ページが見つかりません</h1>
      <p>指定された駅は対象外か、URLが正しくありません。</p>
      {/* トップが池袋駅へのリダイレクトだった頃の名残で /ikebukuro を指していた。
          2026-08-08にトップページが実体を持ったので / に直した */}
      <Link to="/">トップに戻る</Link>
      {/* 存在しないURLはCloudflare Pagesが200でこのSPAを返すため、
          ここが実質の404ページになる。行き止まりにしないよう導線を置く */}
      <p className="not-found-links">
        <Link to="/guide">使い方・スコアの見方</Link> ／ <Link to="/about">運営者情報</Link>
      </p>
    </div>
  );
}
