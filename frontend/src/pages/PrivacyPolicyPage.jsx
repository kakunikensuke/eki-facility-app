import BottomNav from "../components/BottomNav";

export default function PrivacyPolicyPage() {
  return (
    <div className="app-container">
      <header className="hero-header subpage-header">
        <div className="hero-top">
          <div className="page-title">プライバシーポリシー・利用規約</div>
        </div>
      </header>

      <div className="legal-card">
        <p className="legal-updated">最終更新日: 2026-07-18</p>

        <h2>運営者について</h2>
        <p>本サービス「住みやすさ駅前スコア」は個人が開発・運営しています。</p>

        <h2>収集する情報</h2>
        <ul>
          <li>
            お気に入り駅の登録情報は、お使いのブラウザのlocalStorageにのみ保存され、サーバーには送信されません。運営者を含む第三者がこの情報を閲覧することはありません。
          </li>
          <li>
            現時点でアクセス解析ツール（Google Analytics等）は導入していません。導入する場合は本ページを更新してお知らせします。
          </li>
          <li>
            本サービスには将来的に広告（Google
            AdSense等）を掲載する予定です。広告配信事業者はCookie等を使用し、ユーザーの興味に応じた広告を配信する場合があります。
          </li>
        </ul>

        <h2>データの出典・正確性について</h2>
        <p>
          本サービスで表示する周辺施設の件数はOpenStreetMapのデータ（©
          OpenStreetMap contributors、ODbLライセンス）に基づく目安であり、実際の店舗数・状況と異なる場合があります。データの正確性を保証するものではありません。
        </p>

        <h2>免責事項</h2>
        <p>
          本サービスの利用によって生じたいかなる損害についても、運営者は責任を負いません。予告なくサービス内容の変更・停止・終了を行う場合があります。
        </p>

        <h2>お問い合わせ</h2>
        <p>
          現在、メールアドレス等の直接の連絡先は公開しておりません。下記フォームからお問い合わせいただけますが、フォーム機能は準備中のため現時点では送信できません。
        </p>

        <form className="contact-form" onSubmit={(e) => e.preventDefault()}>
          <label className="contact-form-field">
            お名前
            <input type="text" disabled placeholder="準備中" />
          </label>
          <label className="contact-form-field">
            メールアドレス
            <input type="email" disabled placeholder="準備中" />
          </label>
          <label className="contact-form-field">
            お問い合わせ内容
            <textarea rows="4" disabled placeholder="準備中" />
          </label>
          <button type="submit" className="contact-form-submit" disabled>
            送信（準備中）
          </button>
        </form>
      </div>

      <BottomNav />
    </div>
  );
}
