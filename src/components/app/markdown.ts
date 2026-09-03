/** Лёгкий и безопасный markdown → HTML для ответов модели (без внешних зависимостей). */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  const parts = s.split(/(`[^`\n]+`)/g);
  return parts
    .map((p) => {
      if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return `<code>${esc(p.slice(1, -1))}</code>`;
      let t = esc(p);
      t = t.replace(/\*\*([\s\S]+?)\*\*/g, "<b>$1</b>");
      t = t.replace(/__([\s\S]+?)__/g, "<b>$1</b>");
      t = t.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");
      t = t.replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");
      t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--tg-link)">$1</a>');
      return t;
    })
    .join("");
}

function block(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join("\n")).replace(/\n/g, "<br/>")}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      out.push(`<p><b>${inline(h[1])}</b></p>`);
    } else if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      const item = (ul ?? ol)![1];
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(item);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("");
}

export function renderMarkdown(text: string): string {
  const src = text
    .replace(/\\\[([\s\S]+?)\\\]/g, "$1")
    .replace(/\\\(([\s\S]+?)\\\)/g, "$1")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×");
  const out: string[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(src))) {
    out.push(block(src.slice(last, m.index)));
    out.push(`<pre><code>${esc(m[2].replace(/\n$/, ""))}</code></pre>`);
    last = m.index + m[0].length;
  }
  const tail = src.slice(last);
  // незакрытый ``` — показываем как код
  if (tail.includes("```")) {
    const idx = tail.indexOf("```");
    out.push(block(tail.slice(0, idx)));
    out.push(`<pre><code>${esc(tail.slice(idx + 3).replace(/^\w*\n/, ""))}</code></pre>`);
  } else out.push(block(tail));
  return out.join("");
}
