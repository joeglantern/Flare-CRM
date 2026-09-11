/*
 * The five things on this site that genuinely need script, and nothing else.
 *
 * Every page reads and works with this file blocked. The stage, the descent, the parallax and the
 * card row are all CSS bound to scroll position; the menu and the sign-in dialog open on :target;
 * the contact form posts. What is added here is the count on the preloader, the handset answering
 * the cursor, the escape key, the slats between pages, and the toy in the footer.
 */
(function () {
  var root = document.documentElement;
  var still =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;

  /* ── the theme ──────────────────────────────────────────────────────────────────────── */

  var STORE = 'flarehub-theme';

  /*
   * Dark is the default whatever the system says, because that is what the stylesheet paints on a
   * bare :root. Asking the system here made the first press of the toggle a no-op for anyone whose
   * machine is set to light: it computed "currently light", switched to dark, and nothing moved.
   */
  function theme() {
    return root.getAttribute('data-theme') || 'dark';
  }

  function applyTheme(next, remember) {
    root.setAttribute('data-theme', next);
    var button = document.querySelector('[data-theme-toggle]');
    if (button) {
      var other = next === 'light' ? 'dark' : 'light';
      button.setAttribute('aria-label', 'Switch to the ' + other + ' theme');
      var use = button.querySelector('use');
      if (use) use.setAttribute('href', '/assets/icons.svg#' + (next === 'light' ? 'moon' : 'sun'));
    }
    if (remember) {
      try {
        localStorage.setItem(STORE, next);
      } catch {
        // A browser refusing storage is not a reason to refuse the theme.
      }
    }
  }

  var saved;
  try {
    saved = localStorage.getItem(STORE);
  } catch {
    saved = null;
  }
  if (saved === 'light' || saved === 'dark') applyTheme(saved, false);

  /* ── the preloader ──────────────────────────────────────────────────────────────────── */

  /*
   * The head script decided whether there is one at all. What happens here is the count, and it
   * has to be honest twice over: never ahead of the clock, so it cannot flash past in a tenth of a
   * second on a fast connection, and never ahead of the work, so it cannot sit on 99 while the
   * sky is still arriving. It is the lower of the two, and it reaches a hundred by counting rather
   * than by being told to.
   *
   * Handing over sets data-preload="done", which is also what releases the curtain: the two are one
   * movement and must not be timed against each other.
   */
  if (root.getAttribute('data-preload') === 'on') {
    /* Long enough to be read. */
    var FLOOR = 1150;
    /* Long enough for a slow morning in Nairobi, and no longer: nobody waits on a broken image. */
    var CEILING = 3400;
    /* A beat on a hundred, so the last number is seen rather than inferred. */
    var HOLD = 220;

    var number = document.querySelector('[data-count]');
    var started = Date.now();

    /* What the first screen is actually made of, plus the two typefaces. */
    var first = document.querySelectorAll('[data-first]');
    var jobs = first.length + 1;
    var finished = 0;
    var oneDone = function () {
      finished += 1;
    };
    for (var picture of first) {
      var decoding = picture.decode ? picture.decode() : Promise.resolve();
      decoding.then(oneDone, oneDone);
    }
    var fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(oneDone, oneDone);

    var shown = 0;
    var handedOver = false;

    var handOver = function () {
      if (handedOver) return;
      handedOver = true;
      if (number) number.textContent = '100';
      setTimeout(function () {
        root.setAttribute('data-preload', 'done');
        try {
          localStorage.setItem('flarehub-seen', '1');
        } catch {
          // Then they see the count again next time, which is a small price for a private browser.
        }
      }, HOLD);
    };

    var frame = function () {
      var elapsed = Date.now() - started;
      var byClock = elapsed / FLOOR;
      /*
       * A small head start so the number is never stuck on zero while the first request is still in
       * the air, and the rest of the range belongs to the work.
       */
      var byWork = 0.12 + 0.88 * (finished / jobs);
      var target = elapsed >= CEILING ? 1 : Math.min(1, byClock, byWork);

      /* Eased towards the target rather than snapped to it, so the number never jumps. */
      shown += (target - shown) * 0.16;
      if (target >= 1 && shown > 0.985) shown = 1;
      if (number) number.textContent = String(Math.round(shown * 100)).padStart(3, '0');

      if (shown >= 1) {
        handOver();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    /* Whatever happens above, the page is not held hostage. */
    setTimeout(handOver, CEILING);
  }

  /* ── the handset answers the cursor ─────────────────────────────────────────────────── */

  /*
   * One listener, one number, and the stylesheet decides how far each thing travels through its own
   * --depth. The object nearest the reader barely moves and the small ones at the edges move most,
   * which is what makes a flat page read as having a front and a back.
   */
  var drifters = document.querySelectorAll('[data-drift]');
  if (
    drifters.length > 0 &&
    !still &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  ) {
    window.addEventListener(
      'pointermove',
      function (event) {
        var x = ((event.clientX / window.innerWidth - 0.5) * 2 * 12).toFixed(1) + 'px';
        var y = ((event.clientY / window.innerHeight - 0.5) * 2 * 12).toFixed(1) + 'px';
        for (var el of drifters) {
          el.style.setProperty('--drift-x', x);
          el.style.setProperty('--drift-y', y);
        }
      },
      { passive: true },
    );
  }

  /* ── the menu and the dialog ────────────────────────────────────────────────────────── */

  /*
   * Both open on :target so they work with no script. Here they also open without writing a hash
   * into the address bar, and close on escape, which is what anybody who has used a menu expects.
   */
  function open(panel) {
    panel.setAttribute('data-open', '');
    var first = panel.querySelector('a, button, input');
    if (first) first.focus();
  }

  function close(panel) {
    panel.removeAttribute('data-open');
    if (location.hash === '#' + panel.id) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-theme-toggle]');
    if (toggle) {
      event.preventDefault();
      applyTheme(theme() === 'light' ? 'dark' : 'light', true);
      return;
    }

    var opener = event.target.closest('[data-opens]');
    if (opener) {
      var panel = document.getElementById(opener.getAttribute('data-opens'));
      if (panel) {
        event.preventDefault();
        open(panel);
      }
      return;
    }

    var closer = event.target.closest('[data-closes]');
    if (closer) {
      var owner = closer.closest('.menu, .signin');
      if (owner) {
        event.preventDefault();
        close(owner);
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    for (var panel of document.querySelectorAll('.menu[data-open], .signin[data-open]')) {
      close(panel);
    }
  });

  /* ── between pages ──────────────────────────────────────────────────────────────────── */

  /*
   * Eight slats sweep down and the next page is behind them. Nothing waits on the animation
   * finishing beyond a fifth of a second: if the browser is busy or something here throws, the
   * visitor still arrives, late rather than never.
   */
  var slats = document.querySelector('.slats');
  if (slats && !still) {
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      var url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname) return;
      event.preventDefault();
      slats.setAttribute('data-run', '');
      setTimeout(function () {
        location.href = url.href;
      }, 420);
    });
    // Coming back through the history cache would otherwise show the slats still down.
    window.addEventListener('pageshow', function () {
      slats.removeAttribute('data-run');
    });
  }

  /* ── the toy in the footer ──────────────────────────────────────────────────────────── */

  /*
   * Objects fall, land, and can be knocked about with the cursor, and a counter says how many have
   * been hit. It is pointless. It is also the last thing anybody remembers, which is the argument
   * for it. It runs only while the footer is on screen and never under reduced motion.
   */
  var yard = document.querySelector('.footer-play');
  if (yard && !still && 'IntersectionObserver' in window) {
    var pieces = [];
    var score = 0;
    var scoreEl = document.querySelector('[data-score]');
    var running = false;
    var bounds = { w: 0, h: 0 };

    var measure = function () {
      bounds.w = yard.clientWidth;
      bounds.h = yard.clientHeight;
    };
    measure();

    for (var el of yard.querySelectorAll('img')) {
      pieces.push({
        el: el,
        x: (parseFloat(el.dataset.x) / 100) * bounds.w,
        y: -120 - Math.random() * 400,
        vx: 0,
        vy: 0,
        size: el.clientWidth || 110,
        spin: (Math.random() - 0.5) * 24,
        angle: 0,
        hit: false,
      });
    }
    window.addEventListener('resize', measure, { passive: true });

    var pointer = { x: -999, y: -999, on: false };
    yard.addEventListener(
      'pointermove',
      function (event) {
        var box = yard.getBoundingClientRect();
        pointer.x = event.clientX - box.left;
        pointer.y = event.clientY - box.top;
        pointer.on = true;
      },
      { passive: true },
    );
    yard.addEventListener('pointerleave', function () {
      pointer.on = false;
    });

    var step = function () {
      if (!running) return;
      for (var p of pieces) {
        p.vy += 0.55;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.angle += p.spin * 0.06;

        var floor = bounds.h - p.size;
        if (p.y > floor) {
          p.y = floor;
          p.vy *= -0.32;
          p.vx *= 0.8;
          p.spin *= 0.6;
          if (Math.abs(p.vy) < 0.6) p.vy = 0;
        }
        if (p.x < 0) {
          p.x = 0;
          p.vx *= -0.5;
        }
        if (p.x > bounds.w - p.size) {
          p.x = bounds.w - p.size;
          p.vx *= -0.5;
        }

        if (pointer.on) {
          var dx = p.x + p.size / 2 - pointer.x;
          var dy = p.y + p.size / 2 - pointer.y;
          var away = Math.sqrt(dx * dx + dy * dy);
          if (away < p.size * 0.8 && away > 0.01) {
            p.vx += (dx / away) * 7;
            p.vy += (dy / away) * 7 - 3;
            p.spin = (Math.random() - 0.5) * 40;
            if (!p.hit) {
              p.hit = true;
              score += 1;
              if (scoreEl) scoreEl.textContent = String(score).padStart(2, '0');
            }
          }
        }

        p.el.style.transform =
          'translate(' +
          String(Math.round(p.x)) +
          'px,' +
          String(Math.round(p.y)) +
          'px) rotate(' +
          String(Math.round(p.angle)) +
          'deg)';
      }
      requestAnimationFrame(step);
    };

    new IntersectionObserver(function (entries) {
      for (var entry of entries) {
        if (entry.isIntersecting === running) continue;
        running = entry.isIntersecting;
        if (running) {
          measure();
          requestAnimationFrame(step);
        }
      }
    }).observe(yard);
  }

  /* ── the address a company name resolves to ─────────────────────────────────────────── */

  var input = document.getElementById('company');
  var preview = document.getElementById('company-address');
  var go = document.getElementById('company-go');
  if (input && preview && go) {
    var update = function () {
      var slug = input.value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      preview.textContent = (slug || 'yourcompany') + '.flarehub.co.ke';
      go.href = slug ? 'https://' + slug + '.flarehub.co.ke' : '#';
      go.setAttribute('aria-disabled', slug ? 'false' : 'true');
    };
    input.addEventListener('input', update);
    update();
  }
})();
