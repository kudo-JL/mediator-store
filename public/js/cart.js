// public/js/cart.js
// Add-to-cart, quantity updates, remove, with a tiny inline toast.
(function () {
  function setCount(n) {
    const el = document.getElementById('cart-count');
    if (el) el.textContent = n;
  }

  function toast(msg) {
    let t = document.getElementById('cart-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cart-toast';
      Object.assign(t.style, {
        position: 'fixed',
        bottom: '20px',
        insetInlineEnd: '20px',
        background: '#111827',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '10px',
        zIndex: 1000,
        opacity: 0,
        transition: 'opacity .2s',
        fontSize: '0.95rem',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = 1;
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.style.opacity = 0), 1600);
  }

  // Add to cart
  document.addEventListener('submit', async function (e) {
    const form = e.target.closest('.add-to-cart, .add-to-cart-inline');
    if (!form) return;
    e.preventDefault();
    const pid = form.getAttribute('data-product-id');
    const qtyInput = form.querySelector('input[name="quantity"]');
    const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
    try {
      const r = await fetch('/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: parseInt(pid, 10), quantity: qty }),
      });
      const d = await r.json();
      if (r.ok) {
        setCount(d.count);
        toast('✓ تمت الإضافة إلى السلة');
      } else {
        toast('⚠ ' + (d.error || 'error'));
      }
    } catch {
      toast('⚠ error');
    }
  });

  // Cart page: qty change + remove
  document.addEventListener('change', async function (e) {
    const q = e.target.closest('.cart-qty');
    if (!q) return;
    const pid = q.getAttribute('data-product-id');
    const v = parseInt(q.value, 10) || 0;
    try {
      const r = await fetch('/cart/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: parseInt(pid, 10), quantity: v }),
      });
      const d = await r.json();
      if (r.ok) {
        setCount(d.count);
        if (v === 0) {
          const tr = q.closest('tr');
          if (tr) tr.remove();
        }
        // Soft refresh to recompute totals (server is source of truth)
        setTimeout(() => location.reload(), 250);
      }
    } catch {}
  });

  document.addEventListener('click', async function (e) {
    const b = e.target.closest('.cart-remove');
    if (!b) return;
    e.preventDefault();
    const pid = b.getAttribute('data-product-id');
    try {
      const r = await fetch('/cart/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: parseInt(pid, 10) }),
      });
      const d = await r.json();
      if (r.ok) {
        setCount(d.count);
        setTimeout(() => location.reload(), 200);
      }
    } catch {}
  });
})();
