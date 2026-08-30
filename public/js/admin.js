// public/js/admin.js
// Admin-side helpers: confirm dialogs (light), any future client wiring.
(function () {
  // Use a data-confirm attribute as a fallback if the inline onsubmit is not desired.
  document.addEventListener('submit', function (e) {
    const f = e.target;
    if (f.matches('form[data-confirm]')) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    }
  });
})();
