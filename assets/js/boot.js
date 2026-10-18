/* Starts the scanner, registers the service worker and wires the install buttons. */
(function (root) {
  "use strict";
  var VT = root.VT = root.VT || {};
  var deferred = null;

  VT.boot = function (opts) {
    var mount = document.getElementById(opts.mount);
    if (mount) VT.ui.mount(mount, { base: opts.base });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register(opts.base + "sw.js").catch(function () { /* offline copy unavailable */ });
    }

    var btn = document.getElementById("install-btn");
    var banner = document.getElementById("install-banner");
    root.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      if (btn) btn.hidden = false;
      if (banner) banner.classList.add("show");
    });
    root.addEventListener("appinstalled", function () {
      deferred = null;
      if (btn) btn.hidden = true;
      if (banner) banner.classList.remove("show");
    });
    if (btn) btn.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; if (banner) banner.classList.remove("show"); });
    });
  };
})(typeof self !== "undefined" ? self : globalThis);
