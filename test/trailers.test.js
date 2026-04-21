const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { splitTrailers, TRAILER_RE } = require("../src/text-processing.js");

// ── TRAILER_RE ──────────────────────────────────────────────────────

describe("TRAILER_RE", () => {
  it("matches Co-authored-by with email", () => {
    assert.ok(TRAILER_RE.test("Co-authored-by: Alice <alice@example.com>"));
  });

  it("matches Signed-off-by with email", () => {
    assert.ok(TRAILER_RE.test("Signed-off-by: Bob <bob@example.com>"));
  });

  it("matches Fixes with issue number", () => {
    assert.ok(TRAILER_RE.test("Fixes: #123"));
  });

  it("matches Reviewed-by with plain name", () => {
    assert.ok(TRAILER_RE.test("Reviewed-by: someone"));
  });

  it("does not match plain text without colon-space separator", () => {
    assert.ok(!TRAILER_RE.test("This is just a normal sentence."));
  });

  it("does not match a line with colon but no space after it", () => {
    assert.ok(!TRAILER_RE.test("Key:value"));
  });

  it("does not match a line starting with a digit", () => {
    assert.ok(!TRAILER_RE.test("123: bad token"));
  });

  it("does not match an empty string", () => {
    assert.ok(!TRAILER_RE.test(""));
  });

  it("does not match a line that starts with whitespace", () => {
    assert.ok(!TRAILER_RE.test("  Indented: value"));
  });
});

// ── splitTrailers ───────────────────────────────────────────────────

describe("splitTrailers", () => {
  it("returns full text as body when there are no trailers", () => {
    const text = "Fix a bug in the parser.\n\nThis corrects edge-case handling.";
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, text);
    assert.equal(trailers, "");
  });

  it("splits a single trailer preceded by a blank line", () => {
    const text =
      "Subject line\n\nBody paragraph.\n\nSigned-off-by: Alice <a@b.com>";
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, "Subject line\n\nBody paragraph.");
    assert.equal(trailers, "\n\nSigned-off-by: Alice <a@b.com>");
  });

  it("splits multiple trailers", () => {
    const text = [
      "Subject",
      "",
      "Body text here.",
      "",
      "Co-authored-by: Alice <alice@example.com>",
      "Signed-off-by: Bob <bob@example.com>",
    ].join("\n");
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, "Subject\n\nBody text here.");
    assert.equal(
      trailers,
      "\n\nCo-authored-by: Alice <alice@example.com>\nSigned-off-by: Bob <bob@example.com>"
    );
  });

  it("preserves angle-bracket emails intact in trailers", () => {
    const text = [
      "Fix something",
      "",
      "Co-authored-by: User Name <user@example.com>",
    ].join("\n");
    const { body, trailers } = splitTrailers(text);
    assert.ok(trailers.includes("<user@example.com>"));
    assert.equal(body, "Fix something");
  });

  it("handles trailing blank lines after trailers", () => {
    const text = [
      "Subject",
      "",
      "Body.",
      "",
      "Signed-off-by: Dev <d@e.com>",
      "",
      "",
    ].join("\n");
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, "Subject\n\nBody.");
    assert.equal(trailers, "\n\nSigned-off-by: Dev <d@e.com>\n\n");
  });

  it("treats trailers as body when not preceded by a blank line", () => {
    const text = [
      "Subject",
      "",
      "Body line.",
      "Signed-off-by: Someone <s@e.com>",
    ].join("\n");
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, text);
    assert.equal(trailers, "");
  });

  it("does not split Key: value patterns mid-body", () => {
    const text = [
      "Subject",
      "",
      "Note: this is important.",
      "Another line.",
    ].join("\n");
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, text);
    assert.equal(trailers, "");
  });

  it("returns body = text and trailers = '' for empty string", () => {
    const { body, trailers } = splitTrailers("");
    assert.equal(body, "");
    assert.equal(trailers, "");
  });

  it("returns body = text for only-whitespace input", () => {
    const text = "\n\n\n";
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, text);
    assert.equal(trailers, "");
  });

  it("handles text that is only trailers with no body", () => {
    const text = "Co-authored-by: A <a@b.com>\nSigned-off-by: B <b@c.com>";
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, text);
    assert.equal(trailers, "");
  });

  it("handles a single trailer after just a blank line (no body before it)", () => {
    const text = "\nSigned-off-by: Dev <d@e.com>";
    const { body, trailers } = splitTrailers(text);
    assert.equal(body, "");
    assert.equal(trailers, "\n\nSigned-off-by: Dev <d@e.com>");
  });
});
