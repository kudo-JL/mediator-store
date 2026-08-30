// public/js/store.js
// Tiny helpers used by the storefront.
(function () {
  // Smooth-scroll for hash links
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Update cart count on load
  fetch('/cart/count', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : { count: 0 }))
    .then((d) => {
      const el = document.getElementById('cart-count');
      if (el) el.textContent = d.count || 0;
    })
    .catch(() => {});
})();
