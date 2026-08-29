import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CONTACT_FORM_ENDPOINT,
  CONTACT_FORM_AJAX_ENDPOINT,
  CONTACT_FORM_FIELDS,
  CONTACT_FORM_HIDDEN,
  CONTACT_RECEIVED_PATH,
} from "../content/pages";

// お問い合わせフォーム。項目の定義は content/pages.js が持つ。
//
// なぜJSで送るのか:
// 素のPOSTだと、送信後の戻り先を指定する _next が効かず、FormSubmitの英語の
// 完了ページに飛ばされてサイトを離れてしまう（2026-08-15に本番で確認。
// 公式ドキュメントに制約の記載がなく原因を特定できなかったため、_next に
// 依存しない作りにした）。AJAXエンドポイントへ送ってサイト内で遷移させる。
//
// action属性は残してある。プリレンダされた静的HTML（＝JSが動く前や、
// JSを実行しないクローラが見る状態）では素のPOSTとして機能するため、
// JSが失敗しても送信手段は失われない。
function ContactForm() {
  const navigate = useNavigate();
  const [state, setState] = useState("idle"); // idle | sending | error

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setState("sending");

    let response;
    try {
      response = await fetch(CONTACT_FORM_AJAX_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
    } catch {
      // fetch自体が届かなかった場合のみ素のPOSTに切り替える（拡張機能によるCORS遮断など）。
      // ここでページ遷移するので、この後の処理は走らない。
      form.submit();
      return;
    }

    // ステータスだけ見てはいけない。FormSubmitは未有効化のドメインからの送信に対しても
    // HTTP 200を返し、本文で「有効化が必要」と伝えてくる。2026-08-15にこれで
    // 「メールは届いていないのに完了ページを表示する」状態になっていた。
    const payload = await response.json().catch(() => null);
    const accepted = response.ok && String(payload?.success) === "true";
    if (!accepted) {
      setState("error");
      return;
    }
    navigate(CONTACT_RECEIVED_PATH);
  }

  return (
    <form
      className="contact-form"
      action={CONTACT_FORM_ENDPOINT}
      method="POST"
      onSubmit={handleSubmit}
    >
      {CONTACT_FORM_HIDDEN.map((h) => (
        <input key={h.name} type="hidden" name={h.name} value={h.value} />
      ))}
      {/* ボット除け。人間には見えない欄で、埋まっていたら送信を捨てる */}
      <input type="text" name="_honey" style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

      {CONTACT_FORM_FIELDS.map((field) => (
        <label key={field.name}>
          <span>
            {field.label}
            {field.hint && <em>{field.hint}</em>}
          </span>
          {field.kind === "select" && (
            <select name={field.name} required={field.required} defaultValue={field.options[0]}>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          {field.kind === "textarea" && (
            <textarea
              name={field.name}
              rows={field.rows}
              required={field.required}
              placeholder={field.placeholder}
            />
          )}
          {field.kind !== "select" && field.kind !== "textarea" && (
            <input
              type={field.kind}
              name={field.name}
              required={field.required}
              placeholder={field.placeholder}
            />
          )}
        </label>
      ))}

      <button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "送信中..." : "送信する"}
      </button>

      {/* 失敗を黙って飲み込まないこと。「送れたつもりで届いていない」のが最悪なので、
          完了ページには進ませず、送信できなかったことをはっきり伝える */}
      {state === "error" && (
        <p className="contact-form-error" role="alert">
          送信できませんでした。時間をおいて、もう一度お試しください。
        </p>
      )}
    </form>
  );
}

// content/pages.js のブロック配列を描画する。
// 同じブロックからプリレンダ側もHTMLを組む（scripts/prerender.js の blocksToHtml）。
// 型を増やすときは必ず両方に足すこと。片方だけだと画面と静的HTMLの中身がズレる。
export default function ContentBlocks({ blocks }) {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "h2":
        return <h2 key={i}>{block.text}</h2>;
      case "p":
        return <p key={i}>{block.text}</p>;
      case "ul":
        return (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        );
      case "qa":
        return (
          <p key={i}>
            <strong>{block.q}</strong>
            <br />
            {block.a}
          </p>
        );
      case "link":
        return (
          <p key={i}>
            {block.note ? `${block.note} ` : ""}
            <a href={block.href} target="_blank" rel="noreferrer">
              {block.text}
            </a>
          </p>
        );
      // サイト内リンク。<a>ではなく<Link>を使う（リロードを挟まず遷移させる）。
      // プリレンダ側（prerender.jsのblocksToHtml）にも同じcaseが必要
      case "internalLink":
        return (
          <p key={i}>
            <Link to={block.href}>{block.text}</Link>
          </p>
        );
      case "contactForm":
        return <ContactForm key={i} />;
      default:
        return null;
    }
  });
}
