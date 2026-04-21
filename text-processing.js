// Pure text-processing functions for GitHub Commit Message Helper.
// Loaded as a content script (before content.js) and importable in Node
// for testing.

// ── Neovim-style reflow ──────────────────────────────────────────────
//
// Mirrors the behaviour of `gq` in neovim with textwidth=72:
//  - Paragraph breaks (blank lines) are preserved.
//  - List items (lines starting with "- ", "* ", "1. ", etc.) start a
//    new paragraph; continuation lines are indented to the content
//    column.
//  - Indented blocks (4+ leading spaces or a tab) are left untouched
//    (code blocks).
//  - Long words that exceed the wrap column are emitted as-is (not
//    broken mid-word).

// Regex matching a git trailer line: "Token: Value"
const TRAILER_RE = /^[A-Za-z][A-Za-z0-9-]*: .+/;

// Split trailing git trailers (Co-authored-by, Signed-off-by, etc.)
// from the body so they can be preserved verbatim during reflow.
function splitTrailers(text) {
  const lines = text.split("\n");

  // Scan backwards from the end to find contiguous trailer lines,
  // skipping any trailing blank lines.
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === "") {
    end--;
  }
  if (end < 0) return { body: text, trailers: "" };

  let trailerStart = end;
  while (trailerStart >= 0 && TRAILER_RE.test(lines[trailerStart])) {
    trailerStart--;
  }

  // trailerStart now points to the line before the first trailer.
  // We need at least one trailer and the preceding line must be blank.
  const trailerCount = end - trailerStart;
  if (trailerCount === 0) return { body: text, trailers: "" };
  if (trailerStart < 0 || lines[trailerStart].trim() !== "") {
    return { body: text, trailers: "" };
  }

  // Include the blank separator line and any trailing blanks
  const body = lines.slice(0, trailerStart).join("\n");
  const trailers = "\n" + lines.slice(trailerStart).join("\n");
  return { body, trailers };
}

function reflowText(text, width) {
  // Strip trailers before reflowing, re-append them unchanged.
  const { body, trailers } = splitTrailers(text);

  const lines = body.split("\n");
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line -> preserve as paragraph break (collapse runs into one)
    if (line.trim() === "") {
      result.push("");
      i++;
      while (i < lines.length && lines[i].trim() === "") {
        i++;
      }
      continue;
    }

    // Code / indented block -> leave untouched
    if (/^(?: {4,}|\t)/.test(line)) {
      result.push(line);
      i++;
      continue;
    }

    // Detect list item prefix and its indentation
    const listMatch = line.match(/^(\s*(?:[-*+]|\d+[.)]) )/);
    const hangingIndent = listMatch
      ? " ".repeat(listMatch[1].length)
      : "";
    const leadingIndent = line.match(/^(\s*)/)[1];

    // Collect the paragraph: consecutive non-blank lines that are
    // continuation lines (same or deeper indent, not a new list item).
    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === "") break;
      if (/^\s*(?:[-*+]|\d+[.)]) /.test(next)) break;
      if (/^(?: {4,}|\t)/.test(next)) break;
      const nextIndent = next.match(/^(\s*)/)[1];
      if (!listMatch && nextIndent.length < leadingIndent.length) break;
      paraLines.push(next);
      i++;
    }

    // Join the paragraph into one long string, collapsing whitespace.
    const joined = paraLines.map((l) => l.trim()).join(" ");

    // Wrap to `width`, respecting hanging indent.
    const wrapped = wrapLine(joined, width, leadingIndent, hangingIndent);
    result.push(...wrapped);
  }

  return result.join("\n") + trailers;
}

function wrapLine(text, width, firstIndent, restIndent) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let currentLine = firstIndent;
  let isFirst = true;

  for (const word of words) {
    const indent = isFirst ? firstIndent : restIndent;
    const sep = currentLine === indent ? "" : " ";

    if (
      currentLine.length + sep.length + word.length > width &&
      currentLine !== indent
    ) {
      lines.push(currentLine);
      currentLine = restIndent + word;
      isFirst = false;
    } else {
      currentLine += sep + word;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

// ── Markdown stripping ────────────────────────────────────────────────
//
// Strips GitHub-flavoured markdown formatting so the commit message
// reads cleanly in plain-text contexts (git log, email, etc.).
//  - Fenced code blocks (```) → 4-space indented (preserves content,
//    survives reflow as an indented block).
//  - Inline code, bold, italic, strikethrough → plain text.
//  - Links [text](url) → text (url).
//  - Images ![alt](url) → removed.
//  - Heading prefixes (###) → removed.
//  - Horizontal rules (---, ***) → removed.
//  - HTML tags → removed (whitelisted to GitHub's allowed set).
//  - List prefixes, blank lines, indented blocks → preserved.

// Tags GitHub allows through its sanitizer (html-pipeline). Using a
// whitelist means we won't mangle things like <stdin> or <T> in
// technical commit messages.
const HTML_TAGS = [
  "a", "abbr", "b", "bdo", "blockquote", "br", "caption", "cite",
  "code", "dd", "del", "details", "dfn", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "picture",
  "pre", "q", "rp", "rt", "ruby", "s", "samp", "small", "source",
  "span", "strike", "strong", "sub", "summary", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "ul",
  "var", "wbr",
];
const HTML_TAG_RE = new RegExp(
  "</?(" + HTML_TAGS.join("|") + ")(\\s[^>]*)?\\/?>",
  "gi"
);
// Same tag names but for detecting multiline opening tags (no closing >)
const HTML_MULTILINE_OPEN_RE = new RegExp(
  "^\\s*<(" + HTML_TAGS.join("|") + ")(\\s|$)",
  "i"
);

function stripMarkdown(text) {
  const lines = text.split("\n");
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block → convert to 4-space indented
    if (/^```/.test(line.trim())) {
      i++; // skip opening fence
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        result.push("    " + lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      continue;
    }

    // Multiline HTML tag (e.g. <img with attributes across lines) —
    // consume and discard all lines until the closing >.
    if (HTML_MULTILINE_OPEN_RE.test(line) && !/>/.test(line)) {
      i++;
      while (i < lines.length && !/>/.test(lines[i])) {
        i++;
      }
      if (i < lines.length) i++; // skip line with closing >
      continue;
    }

    // Horizontal rules (---, ***, ___) — not valid in commit messages
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      i++;
      continue;
    }

    result.push(stripInlineMarkdown(line));
    i++;
  }

  return result.join("\n");
}

function stripInlineMarkdown(line) {
  let s = line;

  // Heading prefixes: "## Heading" → "Heading"
  s = s.replace(/^(#{1,6})\s+/, "");

  // Images: ![alt](url) → "" (images don't belong in commit messages)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");

  // Links: [text](url) → "text (url)"
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Bold: **text** and __text__ (strip before italic)
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/__(.+?)__/g, "$1");

  // Italic: *text* and _text_ (word-boundary-aware to avoid
  // mangling list items or variable_names)
  s = s.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "$1");
  s = s.replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1");

  // Strikethrough: ~~text~~
  s = s.replace(/~~(.+?)~~/g, "$1");

  // Inline code: ``code`` and `code`
  s = s.replace(/``(.+?)``/g, "$1");
  s = s.replace(/`(.+?)`/g, "$1");

  // <br> → newline rather than just deleting it
  s = s.replace(/<br\s*\/?>/gi, "\n");

  // Remaining HTML tags — whitelisted to the tags GitHub actually
  // allows through its sanitizer. Avoids false positives on <stdin>,
  // <T>, etc.
  s = s.replace(HTML_TAG_RE, "");

  return s;
}

// Combined clean: strip markdown then reflow.
// Trailers are split out first so that angle-bracket emails in lines
// like "Co-authored-by: Name <email>" aren't eaten by the HTML tag
// stripper.
function cleanAndReflow(text, width) {
  const { body, trailers } = splitTrailers(text);
  const cleaned = reflowText(stripMarkdown(body), width);
  return cleaned + trailers;
}

// Node.js exports for testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TRAILER_RE,
    splitTrailers,
    reflowText,
    wrapLine,
    HTML_TAGS,
    HTML_TAG_RE,
    HTML_MULTILINE_OPEN_RE,
    stripMarkdown,
    stripInlineMarkdown,
    cleanAndReflow,
  };
}
