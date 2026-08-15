import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
    try {
      const response = await fetch(CONTACT_FORM_AJAX_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
      if (!response.ok) throw new Error(`FormSubmit responded ${response.status}`);
      navigate(CONTACT_RECEIVED_PATH);
    } catch {
      // 送信手段を失わせないため、JS経由で失敗したら素のPOSTに切り替える。
      // 完了ページはFormSubmitのものになるが、送信自体は成立する。
      setState("error");
      form.submit();
    }
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
      case "contactForm":
        return <ContactForm key={i} />;
      default:
        return null;
    }
  });
}
