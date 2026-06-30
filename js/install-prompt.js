// ══════════════════════════════════════
// install-prompt.js — Tuto interactif "Ajouter à l'écran d'accueil"
//
// Affiché une seule fois, à la première visite, pour inviter le joueur
// à installer NightGames comme une vraie app (plein écran, lancement en
// un tap). On adapte les instructions à la plateforme :
//   • Android / Chrome : on déclenche la vraie pop-up d'installation
//     native (event `beforeinstallprompt`) quand elle est disponible,
//     sinon on guide via le menu ⋮.
//   • iOS / Safari : pas d'API d'install programmatique → tuto visuel
//     pas-à-pas qui pointe le bouton Partager ⬆️.
// ══════════════════════════════════════

const InstallPrompt = (() => {
  const SEEN_KEY = 'ng_install_tuto_seen';

  // Event d'install natif (Android/Chrome/Edge desktop). Capturé tôt car
  // le navigateur ne le redéclenche pas si on rate le premier tir.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    Logger.debug('install', 'beforeinstallprompt capturé');
  });

  // L'app est-elle déjà lancée en mode installé ? (rien à proposer alors)
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
  }

  function isIOS() {
    const ua = navigator.userAgent;
    return /iphone|ipad|ipod/i.test(ua)
        // iPadOS récent se fait passer pour un Mac desktop
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /android/i.test(navigator.userAgent);
  }

  function hasBeenSeen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; }
    catch { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); }
    catch { /* mode privé : on retentera la prochaine fois, pas grave */ }
  }

  // ── Contenu des étapes selon la plateforme ──────────────────
  function buildBody() {
    if (isIOS()) {
      return `
        <div class="install-hero">📲</div>
        <div class="install-title">Installe NightGames</div>
        <div class="install-sub">Ajoute l'app à ton écran d'accueil : lancement en un tap, en plein écran.</div>
        <ol class="install-steps">
          <li class="install-step">
            <span class="install-step-num">1</span>
            <span class="install-step-txt">Touche le bouton <b>Partager</b> <span class="install-icon-ios">${shareIconSVG()}</span> en bas de Safari</span>
          </li>
          <li class="install-step">
            <span class="install-step-num">2</span>
            <span class="install-step-txt">Choisis <b>« Sur l'écran d'accueil »</b> <span class="install-icon-plus">＋</span></span>
          </li>
          <li class="install-step">
            <span class="install-step-num">3</span>
            <span class="install-step-txt">Valide avec <b>Ajouter</b> — l'icône apparaît sur ton écran 🎉</span>
          </li>
        </ol>
        <div class="install-actions">
          <button class="btn-secondary" id="install-later">Plus tard</button>
        </div>
      `;
    }

    // Android / Chrome / Edge — install native si dispo
    if (deferredPrompt) {
      return `
        <div class="install-hero">📲</div>
        <div class="install-title">Installe NightGames</div>
        <div class="install-sub">Ajoute l'app à ton écran d'accueil : lancement en un tap, en plein écran, sans barre du navigateur.</div>
        <div class="install-actions">
          <button class="btn-primary" id="install-now">📥 AJOUTER À L'ÉCRAN D'ACCUEIL</button>
          <button class="btn-secondary" id="install-later">Plus tard</button>
        </div>
      `;
    }

    // Android sans event (ou autre navigateur) → instructions menu ⋮
    return `
      <div class="install-hero">📲</div>
      <div class="install-title">Installe NightGames</div>
      <div class="install-sub">Ajoute l'app à ton écran d'accueil : lancement en un tap, en plein écran.</div>
      <ol class="install-steps">
        <li class="install-step">
          <span class="install-step-num">1</span>
          <span class="install-step-txt">Ouvre le menu <b>⋮</b> en haut à droite du navigateur</span>
        </li>
        <li class="install-step">
          <span class="install-step-num">2</span>
          <span class="install-step-txt">Choisis <b>« Ajouter à l'écran d'accueil »</b> (ou « Installer l'application »)</span>
        </li>
        <li class="install-step">
          <span class="install-step-num">3</span>
          <span class="install-step-txt">Valide — l'icône apparaît sur ton écran 🎉</span>
        </li>
      </ol>
      <div class="install-actions">
        <button class="btn-secondary" id="install-later">Plus tard</button>
      </div>
    `;
  }

  function shareIconSVG() {
    return `<svg viewBox="0 0 50 50" width="18" height="18" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
        d="M25 4 L25 30 M16 13 L25 4 L34 13 M12 22 L8 22 L8 44 L42 44 L42 22 L38 22"/>
    </svg>`;
  }

  // ── Affichage du tuto ───────────────────────────────────────
  function render() {
    const backdrop = document.createElement('div');
    backdrop.id = 'install-backdrop';
    backdrop.className = 'install-backdrop';
    backdrop.innerHTML = `<div class="install-card">${buildBody()}</div>`;
    document.body.appendChild(backdrop);

    // Animation d'entrée au frame suivant
    requestAnimationFrame(() => backdrop.classList.add('show'));

    const close = () => {
      markSeen();
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 250);
    };

    backdrop.querySelector('#install-later')?.addEventListener('click', close);

    // Fermer en tapant en dehors de la carte
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const btnNow = backdrop.querySelector('#install-now');
    if (btnNow && deferredPrompt) {
      btnNow.addEventListener('click', async () => {
        backdrop.classList.remove('show');
        try {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          Logger.info('install', 'Choix utilisateur :', outcome);
        } catch (err) {
          Logger.warn('install', 'Échec du prompt natif', err?.message || err);
        }
        deferredPrompt = null;
        close();
      });
    }
  }

  // ── Point d'entrée ──────────────────────────────────────────
  // skip = true quand on ne veut pas « consommer » la première visite
  // (ex. arrivée via lien QR : on laisse le joueur rejoindre d'abord).
  function maybeShow({ skip = false } = {}) {
    if (skip) { Logger.debug('install', 'Tuto reporté (deep-link join)'); return; }
    if (isStandalone()) { Logger.debug('install', 'Déjà installé, tuto ignoré'); return; }
    if (hasBeenSeen())  { Logger.debug('install', 'Tuto déjà vu, ignoré'); return; }

    // Petit délai : on laisse l'écran d'accueil s'afficher d'abord, le tuto
    // arrive en douceur par-dessus plutôt que de bloquer l'arrivée.
    setTimeout(render, 900);
  }

  return { maybeShow };
})();
