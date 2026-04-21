const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { cleanAndReflow } = require("../src/text-processing.js");

describe("cleanAndReflow", () => {
  it("preserves trailer emails that look like HTML tags", () => {
    const input = [
      "Fix the login bug",
      "",
      "Co-authored-by: Alice <alice@example.com>",
      "Signed-off-by: Bob <bob@example.com>",
    ].join("\n");
    const result = cleanAndReflow(input, 72);
    assert.ok(result.includes("<alice@example.com>"));
    assert.ok(result.includes("<bob@example.com>"));
    assert.ok(result.includes("Co-authored-by:"));
    assert.ok(result.includes("Signed-off-by:"));
  });

  it("cleans a realistic GitHub PR description end-to-end", () => {
    const input = [
      "## Summary",
      "",
      "This PR adds **rate limiting** to the API gateway. It uses a [token bucket](https://en.wikipedia.org/wiki/Token_bucket) algorithm with configurable burst size.",
      "",
      "---",
      "",
      "### Changes",
      "",
      "- Added `RateLimiter` middleware",
      "- Updated config to accept `maxBurst` parameter",
      "",
      "```go",
      "limiter := NewLimiter(rate, burst)",
      "```",
      "",
      "Co-authored-by: Dev <dev@company.com>",
    ].join("\n");
    const result = cleanAndReflow(input, 72);

    // Markdown stripped
    assert.ok(!result.includes("##"));
    assert.ok(!result.includes("**"));
    assert.ok(!result.includes("---"));
    assert.ok(!result.includes("```"));

    // Content preserved
    assert.ok(result.includes("Summary"));
    assert.ok(result.includes("rate limiting"));
    assert.ok(result.includes("token bucket"));
    assert.ok(result.includes("RateLimiter"));

    // Code block became indented
    assert.ok(result.includes("    limiter := NewLimiter(rate, burst)"));

    // Trailer intact with email
    assert.ok(result.includes("Co-authored-by: Dev <dev@company.com>"));

    // Body lines within width
    const lines = result.split("\n");
    const trailerIdx = lines.findIndex((l) => l.startsWith("Co-authored-by:"));
    for (let i = 0; i < trailerIdx; i++) {
      assert.ok(
        lines[i].length <= 72,
        `Line ${i} exceeds 72 cols (${lines[i].length}): "${lines[i]}"`
      );
    }
  });

  it("collapses blank lines left behind after stripping block-level HTML", () => {
    const input = [
      "<p>First paragraph.</p>",
      "",
      "<p>Second paragraph.</p>",
      "",
      "<div>Third.</div>",
    ].join("\n");
    const result = cleanAndReflow(input, 72);

    // Tags stripped
    assert.ok(!result.includes("<p>"));
    assert.ok(!result.includes("<div>"));

    // Content present
    assert.ok(result.includes("First paragraph."));
    assert.ok(result.includes("Second paragraph."));
    assert.ok(result.includes("Third."));

    // No runs of multiple blank lines
    assert.ok(
      !result.includes("\n\n\n"),
      "Should not have 3+ consecutive newlines"
    );
  });

  it("preserves fenced code blocks as indented blocks that survive reflow", () => {
    const input = [
      "Description of the change.",
      "",
      "```",
      "const veryLongVariableName = someFunction(argumentOne, argumentTwo, argumentThree, argumentFour);",
      "```",
    ].join("\n");
    const result = cleanAndReflow(input, 72);
    // Code line should be indented and NOT wrapped despite exceeding 72 cols
    assert.ok(
      result.includes(
        "    const veryLongVariableName = someFunction(argumentOne, argumentTwo, argumentThree, argumentFour);"
      )
    );
  });

  it("handles text with no trailers", () => {
    const input = "## Title\n\nSome **bold** text that is long enough to need wrapping when reflowed to a narrow column width for testing purposes.";
    const result = cleanAndReflow(input, 40);
    assert.ok(!result.includes("##"));
    assert.ok(!result.includes("**"));
    for (const line of result.split("\n")) {
      assert.ok(
        line.length <= 40,
        `Line exceeds 40 cols: "${line}"`
      );
    }
  });

  it("passes through already-clean text unchanged", () => {
    const input = [
      "Short clean line.",
      "",
      "Signed-off-by: Dev <dev@example.com>",
    ].join("\n");
    const result = cleanAndReflow(input, 72);
    assert.equal(result, input);
  });

  it("preserves non-whitelisted angle brackets in body", () => {
    const input = [
      "Read input from <stdin> and parse the <T> parameter.",
      "",
      "Co-authored-by: A <a@b.com>",
    ].join("\n");
    const result = cleanAndReflow(input, 72);
    assert.ok(result.includes("<stdin>"));
    assert.ok(result.includes("<T>"));
    assert.ok(result.includes("<a@b.com>"));
  });

  it("respects a custom width parameter", () => {
    const input =
      "This is a sentence that should be wrapped at fifty columns maximum width.";
    const result = cleanAndReflow(input, 50);
    for (const line of result.split("\n")) {
      assert.ok(
        line.length <= 50,
        `Line exceeds 50 cols (${line.length}): "${line}"`
      );
    }
  });
});
