/** Превращает markdown-подобный ответ модели в безопасный Telegram HTML. */

const TG_LIMIT = 4096;
const SAFE_CHUNK = 3800;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Убираем LaTeX-обёртки, если модель всё же их вставила. */
export function delatex(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, "$1")
    .replace(/\\\(([\s\S]+?)\\\)/g, "$1")
    .replace(/\$\$([\s\S]+?)\$\$/g, "$1")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\boxed\{([^}]*)\}/g, "$1");
}

function inlineFormat(s: string): string {
  // сначала инлайн-код, чтобы внутри него ничего не форматировать
  const parts = s.split(/(`[^`\n]+`)/g);
  return parts
    .map((p) => {
      if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return `<code>${escapeHtml(p.slice(1, -1))}</code>`;
      let t = escapeHtml(p);
      t = t.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
      t = t.replace(/__([\s\S]+?)__/g, "<b>$1</b>");
      t = t.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");
      t = t.replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");
      t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");
      t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
      t = t.replace(/^(\s*)[-*]\s+/gm, "$1• ");
      return t;
    })
    .join("");
}

export function toTelegramHtml(text: string): string {
  const src = delatex(text);
  const out: string[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let mt: RegExpExecArray | null;
  while ((mt = fence.exec(src))) {
    out.push(inlineFormat(src.slice(last, mt.index)));
    const lang = mt[1] ? ` class="language-${escapeHtml(mt[1])}"` : "";
    out.push(`<pre><code${lang}>${escapeHtml(mt[2].replace(/\n$/, ""))}</code></pre>`);
    last = mt.index + mt[0].length;
  }
  out.push(inlineFormat(src.slice(last)));
  return out.join("").trim();
}

/** Режем длинный текст, не разрывая <pre>-блоки где возможно. */
export function splitForTelegram(text: string, limit = SAFE_CHUNK): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.4) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Готовые HTML-куски: форматируем каждый кусок отдельно, чтобы теги не рвались. */
export function renderChunks(raw: string): { html: string; plain: string }[] {
  return splitForTelegram(raw).map((c) => {
    const html = toTelegramHtml(c);
    return { html: html.length > TG_LIMIT ? escapeHtml(c).slice(0, TG_LIMIT) : html, plain: c };
  });
}

/** Извлекаем блоки [FILE:name]...[/FILE], если модель их вернула. */
export function extractFileBlocks(answer: string): { files: { name: string; content: string }[]; rest: string } {
  const files: { name: string; content: string }[] = [];
  const re = /\[FILE:([^\]\n]+)\]\n?([\s\S]*?)\[\/FILE\]/g;
  const rest = answer.replace(re, (_m, name: string, content: string) => {
    files.push({ name: name.trim().replace(/[^\w.\-а-яА-ЯёЁ ]/g, "_"), content });
    return "";
  });
  return { files, rest: rest.trim() };
}
