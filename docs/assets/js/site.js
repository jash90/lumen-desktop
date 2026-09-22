/*
 * The only script on the page: a border under the sticky header once the page
 * scrolls, and a lightbox for the gallery. Everything works without it — the
 * gallery thumbnails are full-resolution images already.
 */
(() => {
  const header = document.querySelector('.site-header');
  if (header) {
    const update = () => header.setAttribute('data-scrolled', String(window.scrollY > 8));
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  // Keep the reader on the same section when they switch language — both
  // versions share their section ids.
  document.querySelectorAll('[data-lang-switch]').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.location.hash) link.hash = window.location.hash;
    });
  });

  const dialog = document.querySelector('.lightbox');
  const triggers = [...document.querySelectorAll('[data-lightbox]')];
  if (!dialog || triggers.length === 0 || typeof dialog.showModal !== 'function') return;

  const image = dialog.querySelector('img');
  const caption = dialog.querySelector('figcaption');
  const counter = dialog.querySelector('[data-counter]');
  let index = 0;

  const show = (next) => {
    index = (next + triggers.length) % triggers.length;
    const source = triggers[index].querySelector('img');
    // currentSrc is whichever <source> the browser picked, so a dark-mode
    // visitor gets the dark screenshot in the lightbox too.
    image.src = source.currentSrc || source.src;
    image.alt = source.alt;
    caption.textContent = triggers[index].dataset.caption || '';
    if (counter) counter.textContent = `${index + 1} / ${triggers.length}`;
  };

  triggers.forEach((trigger, i) => {
    trigger.addEventListener('click', () => {
      show(i);
      dialog.showModal();
    });
  });

  dialog.querySelector('[data-prev]')?.addEventListener('click', () => show(index - 1));
  dialog.querySelector('[data-next]')?.addEventListener('click', () => show(index + 1));
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(index - 1);
    if (event.key === 'ArrowRight') show(index + 1);
  });

  // A click on the backdrop lands on the <dialog> element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => triggers[index]?.focus());
})();
