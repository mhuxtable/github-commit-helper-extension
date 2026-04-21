// Settings popup for GitHub Commit Message Helper

const DEFAULTS = {
  titleLimit: 72,
  bodyWrap: 72,
  autoFormat: true,
};

const els = {};

function init() {
  els.titleLimit = document.getElementById("titleLimit");
  els.bodyWrap = document.getElementById("bodyWrap");
  els.autoFormat = document.getElementById("autoFormat");
  els.saved = document.getElementById("saved");

  // Load saved settings
  browser.storage.local.get(DEFAULTS).then((settings) => {
    els.titleLimit.value = settings.titleLimit;
    els.bodyWrap.value = settings.bodyWrap;
    els.autoFormat.checked = settings.autoFormat;
  });

  // Save on any change
  els.titleLimit.addEventListener("input", save);
  els.bodyWrap.addEventListener("input", save);
  els.autoFormat.addEventListener("change", save);
}

function save() {
  const settings = {
    titleLimit: clamp(parseInt(els.titleLimit.value, 10) || 72, 20, 200),
    bodyWrap: clamp(parseInt(els.bodyWrap.value, 10) || 72, 20, 200),
    autoFormat: els.autoFormat.checked,
  };

  browser.storage.local.set(settings).then(() => {
    // Flash "saved" indicator
    els.saved.classList.add("visible");
    clearTimeout(save._timer);
    save._timer = setTimeout(() => {
      els.saved.classList.remove("visible");
    }, 1200);
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

document.addEventListener("DOMContentLoaded", init);
