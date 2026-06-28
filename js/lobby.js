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
  players: [],
};

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
  document.getElementById('btn-confirm-name').onclick = () => confirmName();
  document.getElementById('btn-leave-lobby').onclick  = () => leaveLobby();
  document.getElementById('btn-copy-code').onclick    = () => copyCode();
  document.getElementById('btn-start-game').onclick   = () => hostStartGame();
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
  _enterLobby();
}

// ══════════════════════════════════════
// JOIN ROOM
// ══════════════════════════════════════
async function doJoinRoom(code, playerId, name, avatar) {
  const room = await DB.getRoom(code);
  if (!room) throw new Error('Salle introuvable');
  if (room.status !== 'waiting') throw new Error('La partie a déjà commencé');

  const me = await DB.joinRoom(room.id, {
    id: playerId, name, avatar, score: 0, role: null, is_host: false
  });

  Session.room   = room;
  Session.me     = me;
  Session.isHost = false;
  _enterLobby();
}

// ══════════════════════════════════════
// ENTER LOBBY (after create or join)
// ══════════════════════════════════════
function _enterLobby() {
  // Show room code
  document.getElementById('room-code-display').textContent = Session.room.code;

  // Show/hide host controls
  document.getElementById('host-controls').classList.toggle('hidden', !Session.isHost);
  document.getElementById('guest-waiting').classList.toggle('hidden', Session.isHost);

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
  if (!Session.selectedGame) return;

  const gameId = Session.selectedGame;
  const gameMeta = GAMES_META.find(g => g.id === gameId);

  // Build initial game state
  const initialState = GameEngines[gameId].initState(Session.players);

  await DB.updateRoom(Session.room.id, {
    status: 'playing',
    game: gameId,
    game_state: initialState,
  });

  // Host also launches (already have state)
  _launchGame(gameId, initialState);
}

function _launchGame(gameId, state) {
  DB.unsub(Session.roomSub);
  DB.unsub(Session.playersSub);

  showScreen('game');
  GameEngines[gameId].mount(
    document.getElementById('game-root'),
    state,
    Session.players,
    Session.me,
    Session.isHost,
    // onStateChange — host pushes new state
    async (newState) => {
      if (Session.isHost) {
        await DB.updateRoom(Session.room.id, { game_state: newState });
      }
    },
    // onEnd
    () => { showScreen('lobby'); _enterLobby(); }
  );
}

// ══════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════
function copyCode() {
  navigator.clipboard.writeText(Session.room.code)
    .then(() => showToast('Code copié ! 📋'))
    .catch(() => showToast(Session.room.code));
}

async function leaveLobby() {
  DB.unsub(Session.roomSub);
  DB.unsub(Session.playersSub);
  if (Session.me) await DB.leaveRoom(Session.me.id);
  if (Session.isHost) await DB.deleteRoom(Session.room.id);
  Session.room = null; Session.me = null;
  showScreen('home');
}
