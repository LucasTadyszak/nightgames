// ══════════════════════════════════════
// lobby.js — Lobby creation & joining
// ══════════════════════════════════════

const AVATARS = ['🐼','🦊','🐸','🦁','🐻','🦋','🐯','🦄','🐺','🦖','🐙','🦈'];

const GAMES_META = [
  { id:'cameleon', name:'Caméléon Urbain',    icon:'🦎', min:3, color:'#7c3aed', g1:'#7c3aed', g2:'#00aaff' },
  { id:'verite',   name:'Vérité ou Défi',     icon:'🔥', min:2, color:'#ff3d6b', g1:'#ff3d6b', g2:'#ff9500' },
  { id:'mission',  name:'Mission Impossible', icon:'🕵️', min:3, color:'#00d4aa', g1:'#00d4aa', g2:'#00aaff' },
  { id:'famille',  name:'Une Famille en Or',  icon:'🏆', min:4, color:'#ff9500', g1:'#ff9500', g2:'#ff3d6b' },
  { id:'loups',    name:'Loups Garous',       icon:'🐺', min:6, color:'#00aaff', g1:'#1e3a8a', g2:'#00aaff' },
  { id:'changer',  name:'Game Changer',       icon:'🎲', min:2, color:'#ff6b35', g1:'#ff6b35', g2:'#7c3aed' },
];

// ── Session state ──────────────────────────────────────────
const Session = {
  room: null,
  me: null,          // player row
  isHost: false,
  selectedGame: null,
  roomSub: null,
  playersSub: null,
  gameSub: null,     // abonnement Realtime unique pour la partie en cours
  players: [],
};

// ── Persisted session (survit à un rafraîchissement de page) ──────────
// On ne stocke que des identifiants (roomId + playerId), jamais l'état
// du jeu lui-même : au retour, on relit tout depuis Supabase (source de
// vérité) pour ne jamais rejouer sur un état périmé.
const SESSION_STORAGE_KEY = 'nightgames_session';

function _saveSession() {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      roomId: Session.room.id,
      playerId: Session.me.id,
    }));
    Logger.debug('lobby', 'Session sauvegardée (localStorage)', Session.room.id, Session.me.id);
  } catch (e) {
    Logger.warn('lobby', 'Impossible de sauvegarder la session (localStorage indisponible)', e.message);
  }
}

function _clearSavedSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (e) {}
}

function _readSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════
// RESTORE — appelé au boot, avant d'afficher l'écran d'accueil.
// Si une session valide est trouvée, on rejoint directement la salle
// (et la partie en cours, le cas échéant) sans repasser par l'accueil.
// ══════════════════════════════════════
async function tryRestoreSession() {
  const saved = _readSavedSession();
  if (!saved) return false;

  Logger.info('lobby', 'Tentative de restauration de session', saved);
  try {
    const room = await DB.getRoomById(saved.roomId);
    if (!room) { Logger.warn('lobby', 'Salle disparue, session abandonnée'); _clearSavedSession(); return false; }

    const me = await DB.getPlayer(saved.playerId);
    if (!me) { Logger.warn('lobby', 'Joueur disparu de la salle, session abandonnée'); _clearSavedSession(); return false; }

    Session.room   = room;
    Session.me     = me;
    Session.isHost = !!me.is_host;

    showToast(`Reconnecté à la salle ${room.code} 🎉`);

    if (room.status === 'playing' && room.game) {
      // On relit la liste de joueurs avant de remonter le jeu (les
      // moteurs en ont besoin pour afficher noms/avatars/scores).
      Session.players = await DB.getPlayers(room.id);
      _launchGame(room.game, room.game_state);
    } else {
      _enterLobby();
    }
    return true;
  } catch (e) {
    Logger.error('lobby', 'Échec de la restauration de session :', e.message || e);
    _clearSavedSession();
    return false;
  }
}

// ══════════════════════════════════════
// LOBBY — Initialise UI bindings
// ══════════════════════════════════════
function initLobby() {
  // Avatar picker on name screen
  const picker = document.getElementById('avatar-picker');
  picker.innerHTML = AVATARS.map((a, i) =>
    `<button class="avatar-btn${i===0?' selected':''}" data-avatar="${a}" onclick="selectAvatar(this,'${a}')">${a}</button>`
  ).join('');

  document.getElementById('btn-create-lobby').onclick = () => startCreateFlow();
  document.getElementById('btn-join-lobby').onclick   = () => startJoinFlow();
  document.getElementById('btn-toggle-code-input').onclick = () => {
    const collapse = document.getElementById('join-code-collapse');
    const isOpen = collapse.classList.toggle('open');
    document.getElementById('btn-toggle-code-input').textContent =
      isOpen ? 'Masquer la saisie ×' : 'Rejoindre avec un code ›';
    if (isOpen) setTimeout(() => document.getElementById('join-code-input').focus(), 320);
  };
  document.getElementById('btn-toggle-qr-link').onclick = () => {
    const collapse = document.getElementById('qr-link-collapse');
    const isOpen = collapse.classList.toggle('open');
    document.getElementById('btn-toggle-qr-link').textContent =
      isOpen ? 'Masquer ×' : 'Pas de scan ? Rejoindre avec le code ›';
  };
  document.getElementById('btn-confirm-name').onclick = () => confirmName();
  document.getElementById('btn-leave-lobby').onclick  = () => leaveLobby();
  document.getElementById('btn-copy-code').onclick    = () => copyCode();
  document.getElementById('btn-copy-link').onclick    = () => copyLink();
  document.getElementById('btn-start-game').onclick   = () => hostStartGame();

  // Bouton "✕" toujours visible pendant le jeu (cf. index.html), peu
  // importe quel moteur de jeu est monté dans #game-root.
  document.getElementById('btn-quit-game').onclick = () => {
    showConfirm(
      '🏁 Terminer la partie ?',
      'Tout le monde reviendra au lobby. La partie en cours sera perdue.',
      () => quitGame(Session.room?.game)
    );
  };
}

let _pendingFlow = null; // 'create' | 'join'

function startCreateFlow() {
  _pendingFlow = 'create';
  document.getElementById('name-screen-title').textContent = 'Choisir un pseudo';
  document.getElementById('btn-confirm-name').textContent  = 'CRÉER LA SALLE ›';
  showScreen('name');
}

function startJoinFlow() {
  const code = document.getElementById('join-code-input').value.trim();
  if (code.length !== 4) { showToast('Entrez un code à 4 lettres'); return; }
  _pendingFlow = 'join:' + code;
  document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
  document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
  showScreen('name');
}

function selectAvatar(btn, avatar) {
  document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

async function confirmName() {
  const name = document.getElementById('player-name-input').value.trim();
  if (!name) { showToast('Entre ton prénom !'); return; }

  const avatar = document.querySelector('.avatar-btn.selected')?.dataset.avatar || '🐼';
  const playerId = crypto.randomUUID();

  const btn = document.getElementById('btn-confirm-name');
  btn.disabled = true; btn.textContent = '…';

  try {
    if (_pendingFlow === 'create') {
      await doCreateRoom(playerId, name, avatar);
    } else {
      const code = _pendingFlow.replace('join:', '');
      await doJoinRoom(code, playerId, name, avatar);
    }
  } catch(e) {
    showToast('Erreur : ' + (e.message || 'connexion impossible'));
    btn.disabled = false;
    btn.textContent = _pendingFlow === 'create' ? 'CRÉER LA SALLE ›' : 'REJOINDRE ›';
  }
}

// ══════════════════════════════════════
// CREATE ROOM
// ══════════════════════════════════════
async function doCreateRoom(playerId, name, avatar) {
  Logger.info('lobby', 'Création de salle par', name);
  // Create the room first
  const tempPlayer = { id: playerId };
  const room = await DB.createRoom(tempPlayer);

  // Join as host
  const me = await DB.joinRoom(room.id, {
    id: playerId, name, avatar, score: 0, role: null, is_host: true
  });

  Session.room    = room;
  Session.me      = me;
  Session.isHost  = true;
  _saveSession();
  _enterLobby();
}

// ══════════════════════════════════════
// JOIN ROOM
// ══════════════════════════════════════
async function doJoinRoom(code, playerId, name, avatar) {
  Logger.info('lobby', name, 'tente de rejoindre la salle', code);
  const room = await DB.getRoom(code);
  if (!room) { Logger.warn('lobby', 'Salle introuvable', code); throw new Error('Salle introuvable'); }
  if (room.status !== 'waiting') { Logger.warn('lobby', 'Salle déjà en cours', code); throw new Error('La partie a déjà commencé'); }

  const me = await DB.joinRoom(room.id, {
    id: playerId, name, avatar, score: 0, role: null, is_host: false
  });

  Session.room   = room;
  Session.me     = me;
  Session.isHost = false;
  _saveSession();
  _enterLobby();
}

// ══════════════════════════════════════
// ENTER LOBBY (after create or join)
// ══════════════════════════════════════
function _enterLobby() {
  // Show room code
  document.getElementById('room-code-display').textContent = Session.room.code;

  // Show/hide host controls & QR
  document.getElementById('host-controls').classList.toggle('hidden', !Session.isHost);
  document.getElementById('qr-block').classList.toggle('hidden', !Session.isHost);
  document.getElementById('guest-waiting').classList.toggle('hidden', Session.isHost);

  // QR code pointant vers l'URL avec le code pré-rempli
  if (Session.isHost) {
    const url = `${location.origin}${location.pathname}?code=${Session.room.code}`;
    Session.joinUrl = url;
    document.getElementById('qr-link-input').value = url;
    const container = document.getElementById('qr-canvas');
    container.innerHTML = '';
    const img = document.createElement('img');
    img.width  = 240;
    img.height = 240;
    img.alt    = `QR code salle ${Session.room.code}`;
    // Noir sur blanc + marge large : une caméra qui filme un écran lit
    // ça bien plus vite/fiablement qu'un QR sombre. Fond blanc = quiet zone.
    img.style.cssText = 'border-radius:10px;background:#fff;padding:10px;display:block;';
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}&margin=12`;
    container.appendChild(img);
  }

  // Build games picker (host only)
  if (Session.isHost) _renderGamesPicker();

  // Subscribe to realtime updates
  Session.roomSub = DB.subscribeRoom(Session.room.id, _onRoomUpdate);
  Session.playersSub = DB.subscribePlayers(Session.room.id, _onPlayersUpdate);

  // Initial player fetch
  DB.getPlayers(Session.room.id).then(_onPlayersUpdate);

  showScreen('lobby');
}

function _renderGamesPicker() {
  const picker = document.getElementById('games-picker');
  picker.innerHTML = GAMES_META.map(g => `
    <button class="game-pick-btn" style="--card-color:${g.color}"
      data-game="${g.id}" onclick="selectGame('${g.id}')">
      <span class="gpb-icon">${g.icon}</span>
      <div class="gpb-info">
        <div class="gpb-name">${g.name}</div>
        <div class="gpb-players">min. ${g.min} joueurs</div>
      </div>
    </button>
  `).join('');
}

function selectGame(id) {
  Logger.info('lobby', 'Jeu sélectionné :', id);
  Session.selectedGame = id;
  document.querySelectorAll('.game-pick-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.game === id);
  });
  _updateStartBtn();
}

function _updateStartBtn() {
  const btn  = document.getElementById('btn-start-game');
  const hint = document.getElementById('min-players-hint');
  const g    = GAMES_META.find(x => x.id === Session.selectedGame);
  const n    = Session.players.length;

  if (!g) { btn.disabled = true; hint.textContent = 'Choisissez un jeu'; return; }
  if (n < g.min) {
    btn.disabled = true;
    hint.textContent = `Il faut au moins ${g.min} joueurs (actuellement ${n})`;
  } else {
    btn.disabled = false;
    hint.textContent = '';
  }
}

// ══════════════════════════════════════
// REALTIME CALLBACKS
// ══════════════════════════════════════
function _onPlayersUpdate(players) {
  Session.players = players;
  const grid = document.getElementById('lobby-players-grid');
  document.getElementById('player-count').textContent = players.length;

  grid.innerHTML = players.map(p => `
    <div class="player-chip ${p.is_host ? 'host' : ''}">
      <span class="player-chip-avatar">${p.avatar}</span>
      <span class="player-chip-name">${p.name}</span>
      ${p.is_host ? '<span class="player-chip-crown">👑</span>' : ''}
    </div>
  `).join('');

  if (Session.isHost) _updateStartBtn();
}

function _onRoomUpdate(room) {
  Session.room = room;
  if (room.status === 'playing' && room.game) {
    _launchGame(room.game, room.game_state);
  }
}

// ══════════════════════════════════════
// HOST: START GAME
// ══════════════════════════════════════
async function hostStartGame() {
  if (!Session.selectedGame) { Logger.warn('lobby', 'hostStartGame appelé sans jeu sélectionné'); return; }

  // Garde-fou : initState() lit GameContent (questions/rôles/règles
  // chargés depuis Supabase au boot) de façon synchrone. Cas rare mais
  // possible sur réseau lent : le host clique avant la fin du chargement.
  if (!GameContent.ready) {
    Logger.warn('lobby', 'GameContent pas encore prêt, on attend avant de lancer la partie');
    showToast('Chargement du contenu des jeux…');
    try { await loadGameContent(); }
    catch (e) {
      Logger.error('lobby', 'Échec du chargement du contenu des jeux :', e.message || e);
      showToast('Impossible de charger le contenu des jeux. Rechargez la page.');
      return;
    }
  }

  const gameId = Session.selectedGame;
  const gameMeta = GAMES_META.find(g => g.id === gameId);
  Logger.info('lobby', 'Lancement de la partie :', gameId, 'avec', Session.players.length, 'joueur(s)');

  const engine = GameEngines[gameId];
  if (!engine) {
    // Si ça arrive, c'est presque toujours un problème d'ordre de
    // chargement des scripts dans index.html (GameEngines doit être
    // déclaré avant js/games/*.js).
    Logger.error('lobby', `Aucun GameEngine enregistré pour "${gameId}". Moteurs disponibles :`, Object.keys(GameEngines));
    showToast('Erreur : ce jeu n\'a pas pu être chargé. Rechargez la page.');
    return;
  }

  const btn = document.getElementById('btn-start-game');
  try {
    btn.disabled = true;

    // Build initial game state
    const initialState = engine.initState(Session.players);
    Logger.debug('lobby', 'État initial généré pour', gameId, initialState);

    await DB.updateRoom(Session.room.id, {
      status: 'playing',
      game: gameId,
      game_state: initialState,
    });

    // Host also launches (already have state)
    _launchGame(gameId, initialState);
  } catch (e) {
    Logger.error('lobby', 'hostStartGame a échoué :', e.message || e);
    showToast('Impossible de lancer la partie : ' + (e.message || 'erreur inconnue'));
    btn.disabled = false;
  }
}

// ══════════════════════════════════════
// QUITTER LA PARTIE EN COURS → retour au lobby.
// Appelé par le bouton "Retour au lobby" en fin de partie (scoreboard)
// ET par le bouton "✕" toujours visible pendant le jeu, pour qu'on
// puisse interrompre une partie à tout moment, pas seulement à la fin.
// ══════════════════════════════════════
function quitGame(gameId) {
  Logger.info('lobby', 'Retour au lobby depuis', gameId || Session.room?.game);
  DB.unsub(Session.gameSub);
  Session.gameSub = null;
  // Seul le host réinitialise la salle en base (status/game/game_state).
  // Sans ça, room.status reste 'playing' avec l'ancienne partie : tout
  // event realtime ultérieur — ou un simple rafraîchissement de page via
  // tryRestoreSession() — relance l'ancienne partie déjà terminée au lieu
  // d'afficher le lobby (et peut faire planter le moteur de jeu qui reçoit
  // un état périmé / une forme de state plus ancienne).
  if (Session.isHost) {
    DB.updateRoom(Session.room.id, { status: 'waiting', game: null, game_state: null })
      .catch(e => Logger.error('lobby', 'Échec de la réinitialisation de la salle :', e.message || e));
  }
  showScreen('lobby');
  _enterLobby();
}

function _launchGame(gameId, state) {
  Logger.debug('lobby', '_launchGame', gameId);
  DB.unsub(Session.roomSub);
  DB.unsub(Session.playersSub);
  DB.unsub(Session.gameSub);
  Session.gameSub = null;

  showScreen('game');
  clearFatalError();
  try {
    // IMPORTANT : un seul abonnement Realtime par partie, géré ICI.
    // Avant, chaque moteur de jeu se désabonnait puis se réabonnait sur le
    // même canal (`room:<roomId>`) à CHAQUE rendu. `removeChannel()` est
    // asynchrone côté supabase-js : si on recrée un canal de même nom avant
    // que l'ancien soit vraiment retiré, la lib renvoie l'ancien objet déjà
    // "subscribed", et y rajouter un listener .on() lève :
    // "cannot add postgres_changes callbacks ... after subscribe()".
    // En ne s'abonnant qu'UNE fois par partie (et en redirigeant chaque
    // mise à jour vers le `render()` courant du moteur via la valeur
    // retournée par mount()), ce problème disparaît structurellement.
    const handleExternalUpdate = GameEngines[gameId].mount(
      document.getElementById('game-root'),
      state,
      Session.players,
      Session.me,
      Session.isHost,
      // onStateChange — pousse le nouvel état en base.
      // NOTE : ce n'est PAS réservé au host. Plusieurs jeux (Vérité ou
      // Défi, Mission Impossible, Loups Garous) ont des actions privées
      // déclenchées par le joueur ACTIF, qui peut être un invité. Si on
      // bloquait l'écriture aux non-hosts ici, l'action de l'invité ne
      // serait jamais persistée en base : son écran changerait localement
      // mais le host et les autres ne verraient jamais rien, et le prochain
      // événement realtime écraserait son changement (partie qui semble
      // bloquée/figée côté invité).
      async (newState) => {
        try {
          await DB.updateRoom(Session.room.id, { game_state: newState });
        } catch (e) {
          Logger.error('lobby', 'Échec de la synchronisation de l\'état du jeu :', e.message || e);
          showToast('Erreur de synchronisation : ' + (e.message || 'inconnue'));
        }
      },
      // onEnd
      () => quitGame(gameId)
    );

    if (typeof handleExternalUpdate === 'function') {
      // tag 'game' : canal distinct de celui du lobby (room:<id>:lobby),
      // qu'on vient de désabonner juste au-dessus — voir le commentaire
      // sur DB.subscribeRoom pour pourquoi ils ne doivent pas partager
      // le même nom de canal.
      Session.gameSub = DB.subscribeRoom(Session.room.id, (room) => {
        if (!room.game_state) return;
        Logger.debug('lobby', 'État de jeu reçu (realtime)', gameId, room.game_state.phase);
        try { handleExternalUpdate(room.game_state); }
        catch (e) {
          Logger.error('lobby', `Échec du re-rendu de "${gameId}" sur update realtime :`, e.message, e.stack);
          showFatalError(e.message);
        }
      }, 'game');
    } else {
      Logger.warn('lobby', `GameEngines['${gameId}'].mount() ne retourne pas de fonction de mise à jour — les autres joueurs ne verront pas les changements en direct.`);
    }
  } catch (e) {
    Logger.error('lobby', `mount() de "${gameId}" a levé une exception :`, e.message || e, e.stack);
    showFatalError(e.message || String(e));
  }
}

// ══════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════
function copyCode() {
  navigator.clipboard.writeText(Session.room.code)
    .then(() => showToast('Code copié ! 📋'))
    .catch(() => showToast(Session.room.code));
}

function copyLink() {
  const url = Session.joinUrl || '';
  navigator.clipboard.writeText(url)
    .then(() => showToast('Lien copié ! 🔗'))
    .catch(() => showToast(url));
}

async function leaveLobby() {
  DB.unsub(Session.roomSub);
  DB.unsub(Session.playersSub);
  DB.unsub(Session.gameSub);
  Session.gameSub = null;
  if (Session.me) await DB.leaveRoom(Session.me.id);
  if (Session.isHost) await DB.deleteRoom(Session.room.id);
  Session.room = null; Session.me = null;
  _clearSavedSession();
  showScreen('home');
}
