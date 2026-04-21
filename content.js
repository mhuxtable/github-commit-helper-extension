// GitHub Commit Message Helper
// Enhances PR merge dialogs with monospace fonts, 72-char line indicators,
// and neovim-style text reflow.

(function() {
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
