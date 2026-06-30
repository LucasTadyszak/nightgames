// ══════════════════════════════════════
// app.js — Router + shared utils
// ══════════════════════════════════════

// ── Screen router ──────────────────────────────────────────
const SCREENS = ['home','name','lobby','game'];

function showScreen(id) {
  SCREENS.forEach(s => {
    document.getElementById(`screen-${s}`)
      .classList.toggle('active', s === id);
  });
  clearFatalError();
}

// ── Toast ──────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Confirm modal (remplace window.confirm) ─────────────────
// window.confirm() est bloquant, mal stylé et parfois silencieusement
// ignoré dans certaines webviews mobiles. On affiche notre propre popup,
// avec de grandes zones tactiles, cohérente avec le reste de l'app.
function showConfirm(title, text, onConfirm) {
  const modal  = document.getElementById('confirm-modal');
  const btnOk  = document.getElementById('confirm-modal-ok');
  const btnNo  = document.getElementById('confirm-modal-cancel');

  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-text').textContent  = text;
  modal.classList.remove('hidden');

  // On clone les boutons pour repartir d'écouteurs propres à chaque appel
  // (sinon les clics précédents s'accumuleraient sur le même bouton).
  const freshOk = btnOk.cloneNode(true);
  const freshNo = btnNo.cloneNode(true);
  btnOk.replaceWith(freshOk);
  btnNo.replaceWith(freshNo);

  const close = () => modal.classList.add('hidden');
  freshOk.addEventListener('click', () => { close(); onConfirm(); });
  freshNo.addEventListener('click', close);
}

// ── Shuffle ────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Scoreboard renderer ────────────────────────────────────
// IMPORTANT : on attache les handlers via addEventListener, jamais via
// onclick="(${fn})()". Sérialiser une fonction en string lui fait perdre
// son scope de closure (ex: `players`, `onStateChange`, `render` ne sont
// plus accessibles) -> ReferenceError silencieux au clic.
function renderScoreboard(container, players, scores, { onReplay, onHome }) {
  Logger.debug('scoreboard', 'render', { players: players.length, scores });
  const sorted = players
    .map(p => ({ ...p, score: scores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score);
  const max = sorted[0]?.score || 1;

  const ranks = ['r1','r2','r3'];
  const labels = ['🥇','🥈','🥉'];

  container.innerHTML = `
    <div class="game-header">
      <div class="game-title">🏆 Scores</div>
    </div>
    <div class="game-body">
      <div class="score-list">
        ${sorted.map((p, i) => `
          <div class="score-row pop" style="animation-delay:${i * .1}s">
            <div class="score-rank ${ranks[i]||''}">${labels[i]||i+1}</div>
            <div class="score-info">
              <div class="score-name">${p.avatar} ${p.name}</div>
              <div class="score-bar-wrap">
                <div class="score-bar" style="width:${Math.max(5, p.score/max*100)}%"></div>
              </div>
            </div>
            <div class="score-pts">${p.score}</div>
          </div>
        `).join('')}
      </div>
      ${onReplay ? `<button class="btn-primary" id="sb-btn-replay">🔄 REJOUER</button>` : ''}
      <button class="btn-secondary" id="sb-btn-home">🏠 Retour au lobby</button>
    </div>
  `;

  if (onReplay) {
    container.querySelector('#sb-btn-replay').addEventListener('click', () => {
      Logger.info('scoreboard', 'Rejouer cliqué');
      onReplay();
    });
  }
  container.querySelector('#sb-btn-home').addEventListener('click', () => {
    Logger.info('scoreboard', 'Retour au lobby cliqué');
    onHome();
  });
}

// ── Back buttons ────────────────────────────────────────────
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

// ── Game engines registry ───────────────────────────────────
// Each game must register itself here
const GameEngines = {};

// ── Contenu des jeux (questions, réponses, rôles, règles…) ───
// Vit en base (cf. supabase_schema.sql + supabase_seed.sql) plutôt que
// codé en dur dans chaque js/games/*.js. Chargé une fois au boot et mis
// en cache ici : initState() reste synchrone (appelé directement au clic
// sur "Lancer la partie"), donc chaque moteur lit GameContent au lieu de
// faire son propre appel réseau à chaque partie.
const GameContent = {
  ready: false,
  cameleonRoles: [],
  cameleonQuestions: [],
  veriteCards: { verite: [], defi: [] },
  missionList: [],
  familleCategories: [],
  familleQuestions: [],
  changerRules: [],
  loupsRoles: {},
};

async function loadGameContent() {
  Logger.info('app', 'Chargement du contenu des jeux depuis Supabase…');
  const [cameleonRoles, cameleonQuestions, veriteCards, missionList, familleCategories, familleQuestions, changerRules, loupsRoles] =
    await Promise.all([
      DB.getCameleonRoles(),
      DB.getCameleonQuestions(),
      DB.getVeriteCards(),
      DB.getMissionList(),
      DB.getFamilleCategories(),
      DB.getFamilleQuestions(),
      DB.getChangerRules(),
      DB.getLoupsRoles(),
    ]);
  Object.assign(GameContent, {
    ready: true,
    cameleonRoles, cameleonQuestions, veriteCards, missionList,
    familleCategories, familleQuestions, changerRules, loupsRoles,
  });
  Logger.info('app', 'Contenu des jeux chargé', {
    cameleonRoles: cameleonRoles.length,
    cameleonQuestions: cameleonQuestions.length,
    veriteCards: veriteCards.verite.length + veriteCards.defi.length,
    missionList: missionList.length,
    familleCategories: familleCategories.length,
    familleQuestions: familleQuestions.length,
    changerRules: changerRules.length,
    loupsRoles: Object.keys(loupsRoles).length,
  });
}

// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  Logger.info('app', 'Boot — initialisation du lobby');
  initLobby();
  QRScanner.init();
  Logger.debug('app', 'GameEngines enregistrés au boot', Object.keys(GameEngines));

  // showScreen('home') reste l'état par défaut tant que le contenu des
  // jeux n'est pas chargé / que la restauration de session n'a pas
  // confirmé une session valide — pas de flash d'écran vide puisque
  // #screen-home a déjà la classe "active" dans le HTML statique.
  // Pré-remplir le code depuis ?code=XXXX (lien QR)
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) {
    // On efface toute session sauvegardée pour ne pas restaurer une vieille
    // salle à la place de celle vers laquelle pointe le QR code.
    _clearSavedSession();
    const input = document.getElementById('join-code-input');
    if (input) input.value = urlCode.toUpperCase();
    // Ouvrir le collapse et lancer directement le flow de join
    const collapse = document.getElementById('join-code-collapse');
    if (collapse) collapse.classList.add('open');
    history.replaceState(null, '', location.pathname);
  }

  showScreen('home');

  try {
    await loadGameContent();
  } catch (e) {
    Logger.error('app', 'Échec du chargement du contenu des jeux :', e.message || e);
    showToast('Erreur de chargement du contenu des jeux. Rechargez la page.');
  }

  const restored = urlCode ? false : await tryRestoreSession();
  Logger.info('app', restored ? 'Session restaurée' : 'Aucune session à restaurer');
});

window.addEventListener('error', (e) => {
  Logger.error('app', 'Erreur JS non interceptée', e.message, e.filename + ':' + e.lineno);
  showFatalError(e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  Logger.error('app', 'Promise rejetée non interceptée', e.reason?.message || e.reason);
  showFatalError(e.reason?.message || String(e.reason));
});

// ── Visible error fallback ──────────────────────────────────
// Sans accès à la console (téléphone), un écran qui reste juste noir
// ne donne aucune information. On affiche donc l'erreur directement
// dans #game-root (ou en overlay si la zone de jeu n'existe pas encore)
// pour pouvoir diagnostiquer sans outils de dev.
function showFatalError(message) {
  const root = document.getElementById('game-root');
  const target = (root && document.getElementById('screen-game').classList.contains('active')) ? root : null;
  const html = `
    <div style="padding:24px;text-align:center;color:#ff3d6b;font-family:'Space Mono',monospace">
      <div style="font-size:32px;margin-bottom:12px">⚠️</div>
      <div style="font-weight:700;margin-bottom:8px">Une erreur est survenue</div>
      <div style="font-size:12px;color:var(--muted);word-break:break-word">${(message || 'Erreur inconnue').toString()}</div>
      <button class="btn-secondary" style="margin-top:20px" onclick="location.reload()">🔄 Recharger la page</button>
    </div>
  `;
  if (target) {
    target.innerHTML = html;
  } else {
    let overlay = document.getElementById('fatal-error-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'fatal-error-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = html;
  }
}

function clearFatalError() {
  const overlay = document.getElementById('fatal-error-overlay');
  if (overlay) overlay.remove();
}
