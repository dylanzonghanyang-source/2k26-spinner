// Theme init: run before first paint. Saved preference wins, otherwise dark.
// External file (not inline) so a strict CSP with script-src 'self' works.
(function () {
  try {
    var t = localStorage.getItem("2kspinner-theme") || localStorage.getItem("2k26-spinner-theme");
    document.documentElement.dataset.theme = (t === "light" || t === "dark") ? t : "dark";
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
