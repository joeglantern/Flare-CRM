/*
 * The four things on this site that need script, and nothing else.
 *
 * Every page reads and works with this file blocked: it is dark, the screenshots are dark, the
 * layers sit on their final frame because the stylesheet says so, and the sign-in control is an
 * ordinary link to a dialog that :target opens. What is added here is the ability to change the
 * theme, to load a recording only when it is reached, and to turn a company name into an address.
 */
(function () {
  var STORE = 'flarehub-theme';
  var root = document.documentElement;

  /*
   * Dark is the default whatever the system says, because that is what the stylesheet paints on a
   * bare :root. Asking the system here made the first press of the toggle a no-op for anyone whose
   * machine is set to light: it computed "currently light", switched to dark, and nothing moved.
   */
  function current() {
    return root.getAttribute('data-theme') || 'dark';
  }

  /*
   * The markup carries the dark screenshots, matching the page's own default, except inside a
   * black panel where the dark shot is the only correct one in either theme. Those are marked
   * data-fixed and left alone.
   */
  function swapShots(theme) {
    var from = theme === 'light' ? '-dark.' : '-light.';
    var to = theme === 'light' ? '-light.' : '-dark.';
    var shots = document.querySelectorAll('picture[data-themed]:not([data-fixed])');
    for (var shot of shots) {
      for (var el of shot.children) {
        if (el.tagName === 'SOURCE') {
          if (el.srcset.indexOf(from) > -1) el.srcset = el.srcset.split(from).join(to);
        } else if (el.tagName === 'IMG' && el.src.indexOf(from) > -1) {
          // The PNG fallback exists in light only, so a dark override keeps the light PNG.
          if (to === '-light.') el.src = el.src.split(from).join(to);
        }
      }
    }
  }

  function apply(theme, remember) {
    root.setAttribute('data-theme', theme);
    swapShots(theme);
    var button = document.querySelector('[data-theme-toggle]');
    if (button) {
      var next = theme === 'light' ? 'dark' : 'light';
      button.setAttribute('aria-label', 'Switch to the ' + next + ' theme');
      var use = button.querySelector('use');
      if (use)
        use.setAttribute('href', '/assets/icons.svg#' + (theme === 'light' ? 'moon' : 'sun'));
    }
    if (remember) {
      try {
        localStorage.setItem(STORE, theme);
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
  if (saved === 'light' || saved === 'dark') apply(saved, false);

  /*
   * One flag for "do not move", set from the system preference and from the absence of
   * scroll-driven animation. The stylesheet already covers both on its own; this makes the state
   * visible to the parts that are not CSS, which is the recordings.
   */
  var still =
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    !(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));
  if (still) root.setAttribute('data-rm', '1');

  /*
   * Recordings load when they are reached and not before: preload="none" plus a source that is
   * only attached on intersection. Under reduced motion nothing loads until the visitor presses
   * play, and until then the poster is the same frame the recording opens on.
   */
  var clips = document.querySelectorAll('video[data-src]');
  function load(video) {
    if (video.dataset.loaded === '1') return;
    video.dataset.loaded = '1';
    var src = document.createElement('source');
    src.src = video.dataset.src;
    src.type = 'video/mp4';
    video.appendChild(src);
    video.load();
  }
  function playable(video) {
    load(video);
    var playing = video.play();
    if (playing && playing.catch) {
      playing.catch(function () {
        // Autoplay refused, which is the browser's call to make and nothing to report.
      });
    }
  }
  if (clips.length > 0 && !still && 'IntersectionObserver' in window) {
    var watcher = new IntersectionObserver(
      function (entries) {
        for (var entry of entries) {
          if (!entry.isIntersecting) continue;
          playable(entry.target);
          watcher.unobserve(entry.target);
        }
      },
      { rootMargin: '200px' },
    );
    for (var watched of clips) watcher.observe(watched);
  }

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-theme-toggle]');
    if (toggle) {
      event.preventDefault();
      apply(current() === 'light' ? 'dark' : 'light', true);
      return;
    }
    var play = event.target.closest('.clip-play');
    if (play) {
      event.preventDefault();
      var clip = play.closest('.clip');
      var video = clip && clip.querySelector('video');
      if (video) {
        play.style.display = 'none';
        playable(video);
      }
      return;
    }
    var open = event.target.closest('[data-signin-open]');
    if (open) {
      var dialog = document.getElementById('signin');
      if (dialog && dialog.showModal) {
        event.preventDefault();
        dialog.showModal();
      }
    }
  });

  /* The address a company name resolves to, shown before they commit to going there. */
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
