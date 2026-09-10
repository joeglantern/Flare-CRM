/*
 * The three things on this site that need script, and nothing else.
 *
 * Every page reads and works with this file blocked: it is dark, the screenshots are dark, and the
 * sign-in control is an ordinary link. What is added here is the ability to change any of that,
 * which by definition cannot be done in CSS alone.
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
   * The markup carries the dark screenshots, matching the page's own default. Choosing the light
   * ones is only possible once somebody has chosen the light theme, and choosing is what script is
   * for. Nothing here runs unless the visitor presses the toggle.
   */
  function swapShots(theme) {
    var from = theme === 'light' ? '-dark.' : '-light.';
    var to = theme === 'light' ? '-light.' : '-dark.';
    var shots = document.querySelectorAll('picture[data-themed]');
    for (var i = 0; i < shots.length; i++) {
      var kids = shots[i].children;
      for (var k = 0; k < kids.length; k++) {
        var el = kids[k];
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
      } catch (err) {
        // A browser refusing storage is not a reason to refuse the theme.
      }
    }
  }

  var saved = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch (err) {
    saved = null;
  }
  if (saved === 'light' || saved === 'dark') apply(saved, false);

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-theme-toggle]');
    if (toggle) {
      event.preventDefault();
      apply(current() === 'light' ? 'dark' : 'light', true);
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
