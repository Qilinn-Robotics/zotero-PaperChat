import MarkdownIt from "markdown-it";
import katex from "katex";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

function summarizeContent(content: string) {
  return content.replace(/\s+/g, " ").slice(0, 160);
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function logRenderStageError(stage: string, content: string, error: unknown) {
  Zotero.debug(
    `PaperChat render stage failed [${stage}] ${describeError(error)} | preview=${summarizeContent(content)}`,
  );
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prepareMath(input: string) {
  const placeholders: string[] = [];
  const pushPlaceholder = (html: string) => {
    const token = `PAPERCHATMATH${placeholders.length}TOKEN`;
    placeholders.push(html);
    return token;
  };

  const rendered = transformMarkdownMath(input, (expr, displayMode, source) => {
    try {
      return pushPlaceholder(
        katex.renderToString(expr.trim(), {
          throwOnError: false,
          displayMode,
        }),
      );
    } catch {
      return pushPlaceholder(
        displayMode ? `<pre>${escapeHtml(expr)}</pre>` : escapeHtml(source),
      );
    }
  });

  return { rendered, placeholders };
}

function restoreMathPlaceholders(input: string, placeholders: string[]) {
  return placeholders.reduce(
    (output, html, index) =>
      output.replaceAll(`PAPERCHATMATH${index}TOKEN`, html),
    input,
  );
}

function transformMarkdownMath(
  input: string,
  replaceMath: (expr: string, displayMode: boolean, source: string) => string,
) {
  let output = "";
  let index = 0;

  while (index < input.length) {
    const fenced = readFencedCodeBlock(input, index);
    if (fenced) {
      output += fenced.segment;
      index = fenced.nextIndex;
      continue;
    }

    const inlineCode = readInlineCodeSpan(input, index);
    if (inlineCode) {
      output += inlineCode.segment;
      index = inlineCode.nextIndex;
      continue;
    }

    const blockBracketMath = readDelimitedMath(
      input,
      index,
      "\\[",
      "\\]",
      true,
    );
    if (blockBracketMath) {
      output += replaceMath(
        blockBracketMath.expr,
        true,
        blockBracketMath.source,
      );
      index = blockBracketMath.nextIndex;
      continue;
    }

    const blockDollarMath = readDelimitedMath(input, index, "$$", "$$", true);
    if (blockDollarMath) {
      output += replaceMath(blockDollarMath.expr, true, blockDollarMath.source);
      index = blockDollarMath.nextIndex;
      continue;
    }

    const inlineBracketMath = readDelimitedMath(
      input,
      index,
      "\\(",
      "\\)",
      false,
    );
    if (inlineBracketMath) {
      output += replaceMath(
        inlineBracketMath.expr,
        false,
        inlineBracketMath.source,
      );
      index = inlineBracketMath.nextIndex;
      continue;
    }

    const inlineDollarMath = readInlineDollarMath(input, index);
    if (inlineDollarMath) {
      output += replaceMath(
        inlineDollarMath.expr,
        false,
        inlineDollarMath.source,
      );
      index = inlineDollarMath.nextIndex;
      continue;
    }

    output += input[index];
    index += 1;
  }

  return output;
}

function readDelimitedMath(
  input: string,
  index: number,
  open: string,
  close: string,
  displayMode: boolean,
) {
  if (!input.startsWith(open, index)) {
    return null;
  }

  const start = index + open.length;
  const end = input.indexOf(close, start);
  if (end < 0) {
    return null;
  }

  const expr = input.slice(start, end);
  if (!expr.trim()) {
    return null;
  }

  if (!displayMode && /[\r\n]/.test(expr)) {
    return null;
  }

  return {
    expr,
    source: input.slice(index, end + close.length),
    nextIndex: end + close.length,
  };
}

function readInlineDollarMath(input: string, index: number) {
  if (input[index] !== "$" || input[index + 1] === "$") {
    return null;
  }

  const nextChar = input[index + 1] ?? "";
  if (!nextChar || /\s/.test(nextChar)) {
    return null;
  }

  for (let cursor = index + 1; cursor < input.length; cursor++) {
    if (input[cursor] !== "$" || input[cursor - 1] === "\\") {
      continue;
    }

    const expr = input.slice(index + 1, cursor);
    if (
      !expr.trim() ||
      /\s$/.test(expr) ||
      /\r|\n/.test(expr) ||
      expr.includes("$")
    ) {
      continue;
    }

    return {
      expr,
      source: input.slice(index, cursor + 1),
      nextIndex: cursor + 1,
    };
  }

  return null;
}

function readFencedCodeBlock(input: string, index: number) {
  const lineStart =
    index === 0 ? 0 : input.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  if (lineStart !== index) {
    return null;
  }

  const line = input.slice(
    lineStart,
    input.indexOf("\n", index) >= 0 ? input.indexOf("\n", index) : input.length,
  );
  const match = line.match(/^( {0,3})(`{3,}|~{3,})/);
  if (!match) {
    return null;
  }

  const fence = match[2];
  const marker = fence[0];
  const minLength = fence.length;
  let cursor = lineStart + line.length;

  while (cursor < input.length) {
    const nextLineEnd = input.indexOf("\n", cursor + 1);
    const segmentEnd = nextLineEnd >= 0 ? nextLineEnd : input.length;
    const segment = input.slice(cursor + 1, segmentEnd);
    const closing = segment.match(/^( {0,3})(`{3,}|~{3,})\s*$/);
    if (closing && closing[2][0] === marker && closing[2].length >= minLength) {
      return {
        segment: input.slice(index, segmentEnd),
        nextIndex: segmentEnd,
      };
    }
    cursor = segmentEnd;
  }

  return {
    segment: input.slice(index),
    nextIndex: input.length,
  };
}

function readInlineCodeSpan(input: string, index: number) {
  if (input[index] !== "`") {
    return null;
  }

  let ticks = 1;
  while (input[index + ticks] === "`") {
    ticks += 1;
  }

  const fence = "`".repeat(ticks);
  const end = input.indexOf(fence, index + ticks);
  if (end < 0) {
    return null;
  }

  return {
    segment: input.slice(index, end + ticks),
    nextIndex: end + ticks,
  };
}

function unescapeCommonMarkdown(raw: string) {
  return raw
    .replace(/\\\*/g, "*")
    .replace(/\\_/g, "_")
    .replace(/\\`/g, "`")
    .replace(/\\~/g, "~");
}

function normalizeInlineEmphasisSpacing(raw: string) {
  let output = "";
  let index = 0;

  while (index < raw.length) {
    const start = raw.indexOf("**", index);
    if (start < 0) {
      output += raw.slice(index);
      break;
    }

    const end = raw.indexOf("**", start + 2);
    if (end < 0) {
      output += raw.slice(index);
      break;
    }

    output += raw.slice(index, start);

    const strong = raw.slice(start, end + 2);
    const before = output[output.length - 1] ?? "";
    const after = raw[end + 2] ?? "";

    if (before && isWordLikeChar(before) && !/\s/.test(before)) {
      output += " ";
    }

    output += strong;

    if (after && isWordLikeChar(after) && !/\s/.test(after)) {
      output += " ";
    }

    index = end + 2;
  }

  return output;
}

function isWordLikeChar(char: string) {
  return /[A-Za-z0-9\u3400-\u9FFF]/.test(char);
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

function normalizeMarkdownContent(content: string) {
  const normalizedContent = normalizeListLayout(
    content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n"),
  ).replace(/\r\n/g, "\n");

  return normalizeInlineEmphasisSpacing(unescapeCommonMarkdown(normalizedContent)).trim();
}

export function renderBasicMarkdownHTML(content: string) {
  let markdownReady = "";

  try {
    markdownReady = normalizeMarkdownContent(content);
  } catch (error) {
    logRenderStageError("normalize-basic", content, error);
    throw error;
  }

  try {
    return md.render(markdownReady);
  } catch (error) {
    logRenderStageError("md-render-basic", markdownReady, error);
    throw error;
  }
}

export function renderMessageHTML(content: string) {
  let markdownReady = "";

  try {
    markdownReady = normalizeMarkdownContent(content);
  } catch (error) {
    logRenderStageError("normalize-full", content, error);
    throw error;
  }

  let rendered = "";
  let placeholders: string[] = [];
  try {
    const prepared = prepareMath(markdownReady);
    rendered = prepared.rendered;
    placeholders = prepared.placeholders;
  } catch (error) {
    logRenderStageError("prepare-math", markdownReady, error);
    throw error;
  }

  let renderedMarkdown = "";
  try {
    renderedMarkdown = md.render(rendered);
  } catch (error) {
    logRenderStageError("md-render-full", rendered, error);
    throw error;
  }

  try {
    return restoreMathPlaceholders(renderedMarkdown, placeholders);
  } catch (error) {
    logRenderStageError("restore-math", renderedMarkdown, error);
    throw error;
  }
}
