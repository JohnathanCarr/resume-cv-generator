// Mockup-only behavior: theme toggle (remembered across the mockup pages),
// tab links, and opening/closing the dialogs shown on a page.
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const set = (theme) => {
    root.dataset.theme = theme;
    toggle?.setAttribute('aria-pressed', String(theme === 'dark'));
  };
  try { const saved = localStorage.getItem('rs-mock-theme'); if (saved) set(saved); } catch {}
  toggle?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    set(next);
    try { localStorage.setItem('rs-mock-theme', next); } catch {}
  });

  document.querySelectorAll('[data-href]').forEach((el) =>
    el.addEventListener('click', () => { location.href = el.dataset.href; }));

  document.querySelectorAll('[data-open]').forEach((el) =>
    el.addEventListener('click', () => document.getElementById(el.dataset.open)?.classList.remove('hidden')));
  document.querySelectorAll('.modal:not(.inline)').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.modal-close, [data-close]')) modal.classList.add('hidden');
    });
  });
})();
