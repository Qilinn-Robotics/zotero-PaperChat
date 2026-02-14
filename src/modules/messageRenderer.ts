import MarkdownIt from "markdown-it";
import katex from "katex";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMath(input: string) {
  let output = input;

  output = output.replace(/\\\[([\s\S]+?)\\\]/g, (_match, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      return `<pre>${escapeHtml(expr)}</pre>`;
    }
  });

  output = output.replace(/\\\(([\s\S]+?)\\\)/g, (_match, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      return `\\(${escapeHtml(expr)}\\)`;
    }
  });

  output = output.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      return `<pre>${escapeHtml(expr)}</pre>`;
    }
  });

  output = output.replace(/\$([^$\n]+?)\$/g, (_match, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      return `$${escapeHtml(expr)}$`;
    }
  });

  return output;
}

function unescapeCommonMarkdown(raw: string) {
  return raw
    .replace(/\\\*/g, "*")
    .replace(/\\_/g, "_")
    .replace(/\\`/g, "`")
    .replace(/\\~/g, "~");
}

function normalizeListLayout(raw: string) {
  const lines = raw.split("\n");
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    const orderedOnly = line.match(/^(\s*\d+\.)\s*$/);
    const unorderedOnly = line.match(/^(\s*[-*+])\s*$/);

    if (orderedOnly || unorderedOnly) {
      let j = i + 1;
      while (j < lines.length && /^\s*$/.test(lines[j])) {
        j++;
      }

      if (j < lines.length) {
        const candidate = lines[j].trim();
        if (candidate) {
          const prefix = (orderedOnly?.[1] || unorderedOnly?.[1] || "").trim();
          merged.push(`${prefix} ${candidate}`);
          i = j;
          continue;
        }
      }
    }

    merged.push(line);
  }

  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of merged) {
    const blank = /^\s*$/.test(line);
    if (blank && prevBlank) {
      continue;
    }
    collapsed.push(blank ? "" : line);
    prevBlank = blank;
  }

  return collapsed.join("\n").trim();
}

export function renderMessageHTML(content: string) {
  const normalizedContent = normalizeListLayout(
    content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n"),
  )
    .replace(/\r\n/g, "\n");

  const markdownReady = unescapeCommonMarkdown(normalizedContent)
    .trim();
  const renderedMarkdown = md.render(markdownReady);
  return renderMath(renderedMarkdown);
}
