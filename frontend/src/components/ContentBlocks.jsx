import {
  CONTACT_FORM_ENDPOINT,
  CONTACT_FORM_FIELDS,
  CONTACT_FORM_HIDDEN,
} from "../content/pages";

// お問い合わせフォーム。項目の定義は content/pages.js が持ち、ここは描画だけ。
// Reactの状態管理は不要（FormSubmitへ素のPOSTで飛ばす）。
function ContactForm() {
  return (
    <form className="contact-form" action={CONTACT_FORM_ENDPOINT} method="POST">
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

      <button type="submit">送信する</button>
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
