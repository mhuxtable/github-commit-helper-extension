const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { reflowText, wrapLine } = require("../text-processing.js");

// ── wrapLine ────────────────────────────────────────────────────────

describe("wrapLine", () => {
  it("wraps text at the specified width", () => {
    const result = wrapLine("one two three four five", 12, "", "");
    assert.deepStrictEqual(result, ["one two", "three four", "five"]);
  });

  it("returns a single empty string for empty input", () => {
    assert.deepStrictEqual(wrapLine("", 72, "", ""), [""]);
  });

  it("returns a single empty string for whitespace-only input", () => {
    assert.deepStrictEqual(wrapLine("   ", 72, "", ""), [""]);
  });

  it("emits a single word longer than width as-is (not broken)", () => {
    const long = "abcdefghijklmnopqrstuvwxyz";
    const result = wrapLine(long, 10, "", "");
    assert.deepStrictEqual(result, [long]);
  });

  it("applies firstIndent to the first line and restIndent to continuations", () => {
    const result = wrapLine("- item one two three four", 16, "", "  ");
    assert.deepStrictEqual(result, [
      "- item one two",
      "  three four",
    ]);
  });

  it("handles firstIndent that adds to the line length", () => {
    const result = wrapLine("hello world foo", 12, "    ", "    ");
    assert.deepStrictEqual(result, ["    hello", "    world", "    foo"]);
  });
});

// ── reflowText ──────────────────────────────────────────────────────

describe("reflowText", () => {
  it("reflows a simple paragraph to 72 columns", () => {
    const words = Array(20).fill("word").join(" ");
    const result = reflowText(words, 72);
    for (const line of result.split("\n")) {
      assert.ok(
        line.length <= 72,
        `Line exceeds 72 cols (${line.length}): "${line}"`
      );
    }
    assert.equal(result.replace(/\n/g, " "), words);
  });

  it("preserves paragraph breaks (blank lines)", () => {
    const input = "first paragraph\n\nsecond paragraph";
    const result = reflowText(input, 72);
    assert.equal(result, "first paragraph\n\nsecond paragraph");
  });

  it("collapses consecutive blank lines into a single blank line", () => {
    const input = "paragraph one\n\n\n\nparagraph two";
    const result = reflowText(input, 72);
    assert.equal(result, "paragraph one\n\nparagraph two");
  });

  it("collapses many blank lines between multiple paragraphs", () => {
    const input = "a\n\n\n\nb\n\n\n\n\nc";
    const result = reflowText(input, 72);
    assert.equal(result, "a\n\nb\n\nc");
  });

  it("starts a new paragraph for - list items with hanging indent", () => {
    const input =
      "- This is a list item that is quite long and should wrap to the next line with a hanging indent aligned to the text.";
    const result = reflowText(input, 72);
    const lines = result.split("\n");
    assert.ok(lines.length >= 2, "Expected wrapped output");
    assert.ok(lines[0].startsWith("- "), "First line starts with '- '");
    for (const line of lines.slice(1)) {
      assert.ok(
        line.startsWith("  "),
        `Continuation line should have hanging indent: "${line}"`
      );
    }
  });

  it("starts a new paragraph for * list items", () => {
    const input = "intro\n* item one\n* item two";
    const result = reflowText(input, 72);
    assert.ok(result.includes("* item one"));
    assert.ok(result.includes("* item two"));
  });

  it("starts a new paragraph for numbered list items", () => {
    const input = "intro\n1. first\n2. second";
    const result = reflowText(input, 72);
    assert.ok(result.includes("1. first"));
    assert.ok(result.includes("2. second"));
  });

  it("does not merge list items with the preceding paragraph", () => {
    const input = "Some intro text here.\n- list item";
    const result = reflowText(input, 72);
    const lines = result.split("\n");
    assert.ok(
      lines.some((l) => l.startsWith("- list")),
      "List item should appear on its own line"
    );
  });

  it("leaves indented blocks (4+ spaces) untouched", () => {
    const code = "    if (x) {\n        return y;\n    }";
    const result = reflowText(code, 72);
    assert.equal(result, code);
  });

  it("leaves tab-indented blocks untouched", () => {
    const code = "\tfor i in range(10):\n\t\tprint(i)";
    const result = reflowText(code, 72);
    assert.equal(result, code);
  });

  it("does not break long words mid-word", () => {
    const longWord = "a".repeat(100);
    const result = reflowText(longWord, 72);
    assert.ok(result.includes(longWord), "Long word should appear intact");
  });

  it("preserves git trailers at the end verbatim", () => {
    const input =
      "Fix the bug\n\nSigned-off-by: Alice <alice@example.com>\nCo-authored-by: Bob <bob@example.com>";
    const result = reflowText(input, 72);
    assert.ok(result.includes("Signed-off-by: Alice <alice@example.com>"));
    assert.ok(result.includes("Co-authored-by: Bob <bob@example.com>"));
  });

  it("does not reflow trailer lines even when over width", () => {
    const longTrailer =
      "Co-authored-by: Someone With A Very Long Name <very.long.email.address@really.long.domain.example.com>";
    const input = "Short body\n\n" + longTrailer;
    const result = reflowText(input, 72);
    assert.ok(
      result.includes(longTrailer),
      "Trailer should be preserved verbatim even if over width"
    );
  });

  it("handles mixed content: paragraph + list + code block + trailers", () => {
    const input = [
      "This is a paragraph that explains the change. It should be reflowed to",
      "fit within the column limit.",
      "",
      "- First list item with some extra text",
      "- Second list item",
      "",
      "    const x = 42;",
      "    return x;",
      "",
      "Signed-off-by: Dev <dev@example.com>",
    ].join("\n");

    const result = reflowText(input, 72);
    const lines = result.split("\n");

    // Paragraph is present and reflowed
    assert.ok(result.includes("This is a paragraph"));

    // List items preserved
    assert.ok(result.includes("- First list item"));
    assert.ok(result.includes("- Second list item"));

    // Code block preserved exactly
    assert.ok(result.includes("    const x = 42;"));
    assert.ok(result.includes("    return x;"));

    // Trailer preserved
    assert.ok(result.includes("Signed-off-by: Dev <dev@example.com>"));

    // No line in the body (before trailers) exceeds 72 cols
    const trailerIdx = lines.findIndex((l) =>
      /^[A-Za-z][A-Za-z0-9-]*: .+/.test(l)
    );
    for (let i = 0; i < trailerIdx; i++) {
      assert.ok(
        lines[i].length <= 72,
        `Body line ${i} exceeds 72 cols (${lines[i].length}): "${lines[i]}"`
      );
    }
  });
});
