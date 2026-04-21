// GitHub Commit Message Helper
// Enhances PR merge dialogs with monospace fonts, 72-char line indicators,
// and neovim-style text reflow.

(function () {
  "use strict";

  // ── Settings ─────────────────────────────────────────────────────────

  const DEFAULTS = { titleLimit: 72, bodyWrap: 72, autoFormat: true };
  let settings = { ...DEFAULTS };

  // Load settings then kick off the observer.
  browser.storage.local.get(DEFAULTS).then((s) => {
    settings = s;
    scanAndSetup();
  });

  // React to settings changes from the popup (live update).
  browser.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) settings[key] = newValue;
    }
    for (const fn of settingsListeners) fn();
  });

  const settingsListeners = [];

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

  // ── Utility ──────────────────────────────────────────────────────────

  function measureTextWidth(element, text) {
    const span = document.createElement("span");
    const style = getComputedStyle(element);
    span.style.font = style.font;
    span.style.fontSize = style.fontSize;
    span.style.fontFamily = style.fontFamily;
    span.style.letterSpacing = style.letterSpacing;
    span.style.visibility = "hidden";
    span.style.position = "absolute";
    span.style.whiteSpace = "pre";
    span.textContent = text;
    document.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
  }

  function measureMonoCharWidth(element) {
    return measureTextWidth(element, "M".repeat(72)) / 72;
  }

  // Set a textarea's value via React's native setter so state stays in sync.
  function setTextareaValue(textarea, value) {
    // Use execCommand so the change lands on the browser's native undo
    // stack (Ctrl/Cmd-Z will revert it).  Works in Firefox 89+.
    textarea.focus();
    textarea.select();
    document.execCommand("insertText", false, value);

    // execCommand already set the value and fired an "input" event.
    // Dispatch "change" for React's state sync.
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ── Title field handling ─────────────────────────────────────────────

  function setupTitleField(input) {
    if (input.dataset.gcmhReady) return;
    input.dataset.gcmhReady = "1";

    // Wrap the input in a position:relative container so we can overlay
    // the guide line and counter on top of it.
    const wrapper = document.createElement("div");
    wrapper.className = "gcmh-title-wrapper";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // Guide line at column 72 (always visible)
    const guide = document.createElement("div");
    guide.className = "gcmh-title-guide";
    wrapper.appendChild(guide);

    // Inline counter, positioned far right inside the input
    const counter = document.createElement("span");
    counter.className = "gcmh-title-counter";
    wrapper.appendChild(counter);
    input.classList.add("gcmh-has-counter");

    function update() {
      const len = input.value.length;

      // Update counter
      counter.textContent = `${len}/${settings.titleLimit}`;
      counter.classList.toggle("gcmh-over", len > settings.titleLimit);

      // Position the guide line at column 72.
      // We measure the width of 72 "M" chars for a stable position,
      // since the input may scroll horizontally.
      const style = getComputedStyle(input);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const charWidth = measureMonoCharWidth(input);
      guide.style.left = (paddingLeft + charWidth * settings.titleLimit) + "px";
      guide.classList.toggle("gcmh-over", len > settings.titleLimit);

      // Red background gradient from column 72 onward when over limit
      if (len > settings.titleLimit) {
        input.classList.add("gcmh-over-limit");
        const pos = measureTextWidth(
          input,
          input.value.substring(0, settings.titleLimit)
        );
        const paddingL = parseFloat(style.paddingLeft) || 0;
        input.style.setProperty("--gcmh-limit-pos", (paddingL + pos) + "px");
      } else {
        input.classList.remove("gcmh-over-limit");
      }
    }

    input.addEventListener("input", update);
    settingsListeners.push(update);

    // Defer initial measurement until fonts are loaded and layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(update);
    });
  }

  // ── Textarea (body) handling ─────────────────────────────────────────

  function setupTextarea(textarea) {
    if (textarea.dataset.gcmhReady) return;
    textarea.dataset.gcmhReady = "1";

    // Wrap the textarea. We need to be careful to preserve layout.
    const wrapper = document.createElement("div");
    wrapper.className = "gcmh-textarea-wrapper";
    textarea.parentNode.insertBefore(wrapper, textarea);
    wrapper.appendChild(textarea);

    // Backdrop for highlighting overflow regions
    const backdrop = document.createElement("div");
    backdrop.className = "gcmh-backdrop";
    wrapper.insertBefore(backdrop, textarea);

    // Ruler at column 72
    const ruler = document.createElement("div");
    ruler.className = "gcmh-ruler";
    wrapper.appendChild(ruler);

    textarea.classList.add("gcmh-has-backdrop");

    // Toolbar at the bottom of the textarea
    const toolbar = document.createElement("div");
    toolbar.className = "gcmh-toolbar";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gcmh-reflow-btn";
    btn.title = "Reflow text to configured column width (neovim gq style)";
    function updateReflowLabel() {
      btn.textContent = `Reflow to ${settings.bodyWrap} cols`;
    }
    updateReflowLabel();
    btn.addEventListener("click", () => {
      setTextareaValue(textarea, reflowText(textarea.value, settings.bodyWrap));
      updateBackdrop();
    });

    // "Clean & reflow" — visible when auto-format is off, so the user
    // can trigger markdown stripping manually.
    const cleanBtn = document.createElement("button");
    cleanBtn.type = "button";
    cleanBtn.className = "gcmh-reflow-btn gcmh-clean-btn";
    cleanBtn.textContent = "Clean & reflow";
    cleanBtn.title = "Strip markdown formatting and reflow";
    cleanBtn.addEventListener("click", () => {
      const raw = textarea.value;
      const cleaned = cleanAndReflow(raw, settings.bodyWrap);
      if (cleaned !== raw) {
        originalText = raw;
        setTextareaValue(textarea, cleaned);
        undoBtn.style.display = "";
      }
      updateBackdrop();
    });

    const hint = document.createElement("span");
    hint.className = "gcmh-toolbar-hint";
    function updateHint() {
      hint.textContent = `Wrap to ${settings.bodyWrap} columns`;
    }
    updateHint();

    // "Undo autoformat" button — one-shot, restores the original text
    // that was in the textarea before we auto-cleaned it on first render.
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "gcmh-reflow-btn gcmh-undo-btn";
    undoBtn.textContent = "Undo autoformat";
    undoBtn.title = "Restore the original PR description before auto-cleaning";
    undoBtn.style.display = "none"; // hidden until auto-clean runs

    function updateToolbarVisibility() {
      cleanBtn.style.display = settings.autoFormat ? "none" : "";
    }
    updateToolbarVisibility();

    toolbar.appendChild(btn);
    toolbar.appendChild(cleanBtn);
    toolbar.appendChild(undoBtn);
    toolbar.appendChild(hint);
    wrapper.appendChild(toolbar);

    function updateBackdrop() {
      // Sync scroll positions
      backdrop.scrollTop = textarea.scrollTop;
      backdrop.scrollLeft = textarea.scrollLeft;

      // Match textarea dimensions and style
      const style = getComputedStyle(textarea);
      backdrop.style.width = style.width;
      backdrop.style.height = style.height;
      backdrop.style.padding = style.padding;
      backdrop.style.fontSize = style.fontSize;
      backdrop.style.fontFamily = style.fontFamily;
      backdrop.style.lineHeight = style.lineHeight;
      backdrop.style.letterSpacing = style.letterSpacing;
      backdrop.style.borderWidth = style.borderWidth;
      backdrop.style.borderStyle = "solid";
      backdrop.style.borderColor = "transparent";
      backdrop.style.boxSizing = style.boxSizing;
      backdrop.style.borderRadius = style.borderRadius;

      // Position ruler at column 72
      const charWidth = measureMonoCharWidth(textarea);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const borderLeft = parseFloat(style.borderLeftWidth) || 0;
      ruler.style.left = (borderLeft + paddingLeft + charWidth * settings.bodyWrap) + "px";
      ruler.style.height = style.height;

      // Build backdrop content: highlight overflow portions
      const text = textarea.value;
      const lines = text.split("\n");

      backdrop.textContent = "";
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) backdrop.appendChild(document.createTextNode("\n"));
        const line = lines[i];
        if (line.length <= settings.bodyWrap) {
          backdrop.appendChild(document.createTextNode(line));
        } else {
          backdrop.appendChild(document.createTextNode(line.substring(0, settings.bodyWrap)));
          const span = document.createElement("span");
          span.className = "gcmh-line-overflow";
          span.textContent = line.substring(settings.bodyWrap);
          backdrop.appendChild(span);
        }
      }
    }

    textarea.addEventListener("input", updateBackdrop);
    textarea.addEventListener("scroll", () => {
      backdrop.scrollTop = textarea.scrollTop;
      backdrop.scrollLeft = textarea.scrollLeft;
    });

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(updateBackdrop).observe(textarea);
    }

    // Re-render when settings change from the popup
    settingsListeners.push(() => {
      updateReflowLabel();
      updateHint();
      updateToolbarVisibility();
      updateBackdrop();
    });

    // Auto-clean: strip markdown + reflow on first render.
    // Store the original text so the user can undo it once.
    let originalText = null;

    undoBtn.addEventListener("click", () => {
      if (originalText !== null) {
        setTextareaValue(textarea, originalText);
        updateBackdrop();
        originalText = null;
        undoBtn.style.display = "none";
      }
    });

    // Defer initial update so layout is settled, then auto-clean if enabled.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (settings.autoFormat) {
          const raw = textarea.value;
          const cleaned = cleanAndReflow(raw, settings.bodyWrap);
          if (cleaned !== raw) {
            originalText = raw;
            setTextareaValue(textarea, cleaned);
            undoBtn.style.display = "";
          }
        }
        updateBackdrop();
      });
    });
  }

  // ── Observer: detect merge box appearing ─────────────────────────────

  function scanAndSetup() {
    const mergeBox = document.querySelector(
      '[data-testid="mergebox-partial"]'
    );
    if (!mergeBox) return;

    // Title — look for the input inside the "Commit message" form control
    const titleInput = mergeBox.querySelector(
      "input.prc-components-Input-IwWrt"
    );
    if (titleInput) setupTitleField(titleInput);

    // Body — look for the textarea inside "Extended description"
    const bodyTextarea = mergeBox.querySelector(
      "textarea.prc-Textarea-TextArea-snlco"
    );
    if (bodyTextarea) setupTextarea(bodyTextarea);
  }

  // Run on page load
  scanAndSetup();

  // GitHub is an SPA — watch for DOM changes
  const observer = new MutationObserver(() => {
    scanAndSetup();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
