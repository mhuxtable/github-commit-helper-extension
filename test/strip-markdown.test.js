const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  stripMarkdown,
  stripInlineMarkdown,
  HTML_TAG_RE,
  HTML_MULTILINE_OPEN_RE,
} = require("../src/text-processing.js");

// ── HTML_TAG_RE ─────────────────────────────────────────────────────

describe("HTML_TAG_RE", () => {
  it("matches whitelisted opening tags", () => {
    for (const tag of ["div", "span", "strong", "em", "p", "ul", "li"]) {
      HTML_TAG_RE.lastIndex = 0;
      assert.ok(HTML_TAG_RE.test(`<${tag}>`), `should match <${tag}>`);
    }
  });

  it("matches whitelisted closing tags", () => {
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(HTML_TAG_RE.test("</div>"));
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(HTML_TAG_RE.test("</span>"));
  });

  it("matches tags with attributes", () => {
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(HTML_TAG_RE.test('<img src="x.png">'));
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(HTML_TAG_RE.test('<a href="url">'));
  });

  it("matches self-closing tags", () => {
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(HTML_TAG_RE.test("<br/>"));
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(HTML_TAG_RE.test("<br />"));
  });

  it("does NOT match non-whitelisted angle brackets", () => {
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(!HTML_TAG_RE.test("<stdin>"));
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(!HTML_TAG_RE.test("<T>"));
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(!HTML_TAG_RE.test("<MyComponent>"));
    HTML_TAG_RE.lastIndex = 0;
    assert.ok(!HTML_TAG_RE.test("<custom-element>"));
  });
});

// ── HTML_MULTILINE_OPEN_RE ──────────────────────────────────────────

describe("HTML_MULTILINE_OPEN_RE", () => {
  it("matches a whitelisted tag at start of line without closing >", () => {
    assert.ok(HTML_MULTILINE_OPEN_RE.test("<img "));
    assert.ok(HTML_MULTILINE_OPEN_RE.test("<div "));
    assert.ok(HTML_MULTILINE_OPEN_RE.test("  <img "));
  });

  it("does not match non-whitelisted tags", () => {
    assert.ok(!HTML_MULTILINE_OPEN_RE.test("<stdin "));
    assert.ok(!HTML_MULTILINE_OPEN_RE.test("<T "));
  });
});

// ── stripInlineMarkdown ─────────────────────────────────────────────

describe("stripInlineMarkdown", () => {
  it("removes heading prefixes (all levels)", () => {
    assert.equal(stripInlineMarkdown("# Heading"), "Heading");
    assert.equal(stripInlineMarkdown("## Heading"), "Heading");
    assert.equal(stripInlineMarkdown("### Heading"), "Heading");
    assert.equal(stripInlineMarkdown("###### Heading"), "Heading");
  });

  it("removes images", () => {
    assert.equal(stripInlineMarkdown("![alt](http://img.png)"), "");
    assert.equal(
      stripInlineMarkdown("before ![alt](url) after"),
      "before  after"
    );
  });

  it("converts links to text (url)", () => {
    assert.equal(
      stripInlineMarkdown("[click here](http://example.com)"),
      "click here (http://example.com)"
    );
  });

  it("strips bold **text** and __text__", () => {
    assert.equal(stripInlineMarkdown("**bold**"), "bold");
    assert.equal(stripInlineMarkdown("__bold__"), "bold");
  });

  it("strips italic *text* and _text_", () => {
    assert.equal(stripInlineMarkdown("*italic*"), "italic");
    assert.equal(stripInlineMarkdown("_italic_"), "italic");
  });

  it("does not mangle variable_names with underscores", () => {
    assert.equal(stripInlineMarkdown("my_variable_name"), "my_variable_name");
  });

  it("does not mangle list items starting with *", () => {
    // "* item" — the * is followed by space, not matched as italic
    assert.equal(stripInlineMarkdown("* item"), "* item");
  });

  it("strips strikethrough ~~text~~", () => {
    assert.equal(stripInlineMarkdown("~~deleted~~"), "deleted");
  });

  it("strips inline code `code` and ``code``", () => {
    assert.equal(stripInlineMarkdown("`code`"), "code");
    assert.equal(stripInlineMarkdown("``code``"), "code");
  });

  it("converts <br> variants to newline", () => {
    assert.equal(stripInlineMarkdown("<br>"), "\n");
    assert.equal(stripInlineMarkdown("<br/>"), "\n");
    assert.equal(stripInlineMarkdown("<br />"), "\n");
    assert.equal(stripInlineMarkdown("<BR>"), "\n");
  });

  it("removes whitelisted HTML tags", () => {
    assert.equal(stripInlineMarkdown("<div>content</div>"), "content");
    assert.equal(stripInlineMarkdown("<strong>bold</strong>"), "bold");
    assert.equal(stripInlineMarkdown('<p class="x">text</p>'), "text");
  });

  it("preserves non-whitelisted angle brackets", () => {
    assert.equal(stripInlineMarkdown("read from <stdin>"), "read from <stdin>");
    assert.equal(stripInlineMarkdown("generic <T>"), "generic <T>");
    assert.equal(
      stripInlineMarkdown("<MyComponent> renders"),
      "<MyComponent> renders"
    );
  });

  it("handles combined inline formatting", () => {
    const input = "**bold** and *italic* and `code` and [link](url)";
    const result = stripInlineMarkdown(input);
    assert.equal(result, "bold and italic and code and link (url)");
  });
});

// ── stripMarkdown (block-level) ─────────────────────────────────────

describe("stripMarkdown", () => {
  it("converts fenced code blocks to 4-space indented", () => {
    const input = "```\nconst x = 1;\nreturn x;\n```";
    const result = stripMarkdown(input);
    assert.equal(result, "    const x = 1;\n    return x;");
  });

  it("converts fenced code blocks with language tag", () => {
    const input = "```js\nconst x = 1;\n```";
    const result = stripMarkdown(input);
    assert.equal(result, "    const x = 1;");
  });

  it("consumes and discards multiline HTML tags", () => {
    const input = [
      "before",
      "<img",
      '  src="photo.png"',
      '  alt="photo">',
      "after",
    ].join("\n");
    const result = stripMarkdown(input);
    assert.equal(result, "before\nafter");
  });

  it("removes horizontal rules (---)", () => {
    assert.equal(stripMarkdown("before\n---\nafter"), "before\nafter");
  });

  it("removes horizontal rules (***)", () => {
    assert.equal(stripMarkdown("before\n***\nafter"), "before\nafter");
  });

  it("removes horizontal rules (___)", () => {
    assert.equal(stripMarkdown("before\n___\nafter"), "before\nafter");
  });

  it("removes spaced horizontal rules (- - -)", () => {
    assert.equal(stripMarkdown("before\n- - -\nafter"), "before\nafter");
  });

  it("removes spaced horizontal rules (* * *)", () => {
    assert.equal(stripMarkdown("before\n* * *\nafter"), "before\nafter");
  });

  it("removes images that are wrapped across multiple lines", () => {
    const input = "before\n![Latency graph from\n  staging](https://grafana.internal/render/d/pool-health)\nafter";
    const result = stripMarkdown(input);
    assert.ok(!result.includes("!["), "image syntax should be stripped");
    assert.ok(!result.includes("grafana.internal"), "image URL should be stripped");
    assert.ok(result.includes("before"));
    assert.ok(result.includes("after"));
  });

  it("converts links that are wrapped across multiple lines", () => {
    const input = "See the [connection pool\n  RFC](https://docs.internal/rfcs/conn-pool-v2) for details";
    const result = stripMarkdown(input);
    assert.ok(!result.includes("[connection"), "link syntax should be stripped");
    assert.ok(result.includes("connection pool"));
    assert.ok(result.includes("https://docs.internal/rfcs/conn-pool-v2"));
  });

  it("passes plain text through unchanged", () => {
    const input = "Just a normal line of text.";
    assert.equal(stripMarkdown(input), input);
  });

  it("handles a mixed document", () => {
    const input = [
      "## Summary",
      "",
      "This has **bold** and a [link](http://x.com).",
      "",
      "---",
      "",
      "```",
      "code here",
      "```",
      "",
      "<div>wrapped</div>",
    ].join("\n");
    const result = stripMarkdown(input);
    assert.ok(result.includes("Summary"));
    assert.ok(!result.includes("##"));
    assert.ok(!result.includes("**"));
    assert.ok(result.includes("link (http://x.com)"));
    assert.ok(!result.includes("---"));
    assert.ok(result.includes("    code here"));
    assert.ok(result.includes("wrapped"));
    assert.ok(!result.includes("<div>"));
  });
});
