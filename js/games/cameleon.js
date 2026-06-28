// ══════════════════════════════════════
// games/cameleon.js
// ══════════════════════════════════════

const CAMELEON_ROLES = [
  { role:'Chef cuisinier stressé',     hint:'Tu brûles tout ce que tu touches ce soir' },
  { role:'Agent secret en mission',    hint:'Tu dois garder ton identité secrète à tout prix' },
  { role:'Influenceur en perte de vues', hint:'Tu cherches désespérément du contenu pour tes réseaux' },
  { role:'Touriste perdu dans ta ville', hint:'Tout te semble étrange et nouveau' },
  { role:'Médecin de garde épuisé',    hint:'Tu n\'as pas dormi depuis 36 heures' },
  { role:'Milliardaire incognito',     hint:'Tu essaies de passer inaperçu mais tu n\'y arrives pas' },
  { role:'Détective privé en filature', hint:'Tu observes tout le monde avec suspicion' },
  { role:'Rockstar en retraite forcée', hint:'Tu parles de ta gloire passée à tout moment' },
];

const CAMELEON_QUESTIONS = [
  'Si tu étais un plat, tu serais lequel ?',
  'Décris ta soirée idéale en 3 mots.',
  'Quel animal te représente le mieux ce soir ?',
  'Si tu devais fuir quelque part maintenant, où tu irais ?',
  'Quel est ton superpouvoir secret ?',
  'Décris ta journée comme si c\'était un film.',
];

function _cameleonOptionsFor(role) {
  const wrongOptions = shuffle(CAMELEON_ROLES.filter(r => r.role !== role.role)).slice(0, 3);
  return shuffle([role, ...wrongOptions]).map(o => o.role);
}

// Calcule les scores une fois que la révélation est déclenchée :
// +1 par invité ayant correctement deviné, +2 au joueur actif si personne
// n'a trouvé.
function _cameleonReveal(s, players) {
  const scores = { ...s.scores };
  let anyCorrect = false;
  Object.entries(s.guesses).forEach(([playerId, guess]) => {
    if (guess === s.role.role) {
      scores[playerId] = (scores[playerId] || 0) + 1;
      anyCorrect = true;
    }
  });
  if (!anyCorrect) {
    scores[s.activeRolePlayerId] = (scores[s.activeRolePlayerId] || 0) + 2;
  }
  return { ...s, scores, revealed: true };
}

GameEngines['cameleon'] = {

  initState(players) {
    const role = CAMELEON_ROLES[Math.floor(Math.random() * CAMELEON_ROLES.length)];
    const question = CAMELEON_QUESTIONS[Math.floor(Math.random() * CAMELEON_QUESTIONS.length)];
    const order = shuffle(players.map(p => p.id));
    const scores = Object.fromEntries(players.map(p => [p.id, 0]));
    // Assign the secret role to the first player in shuffled order
    const activeRolePlayerId = order[0];
    return {
      phase: 'show_role',     // show_role | guessing | scores
      turn: 0,
      order,
      role,
      question,
      activeRolePlayerId,
      scores,
      options: [],         // choix multiples affichés pendant 'guessing' (générés une fois par tour)
      guesses: {},         // playerId -> rôle deviné (un par joueur non-actif)
      revealed: false,
      totalRounds: players.length * 2,
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    let _sub = null;
    // IMPORTANT : on désabonne au début de chaque render(), sinon chaque
    // mise à jour empile une nouvelle souscription Realtime (fuite de
    // listeners + rendus en double / désynchronisés).
    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
      // Tolère un state persisté par une version antérieure du jeu
      // (avant l'ajout de guesses/options/revealed) pour ne pas planter
      // sur une partie déjà en cours au moment de la mise à jour.
      s = { options: [], guesses: {}, revealed: false, ...s };
      root.innerHTML = '';
      const myId = me.id;
      const activeId = s.activeRolePlayerId;
      const amActive = myId === activeId;
      const activeName = players.find(p => p.id === activeId)?.name || '?';
      const activeAvatar = players.find(p => p.id === activeId)?.avatar || '?';
      const nonActivePlayers = players.filter(p => p.id !== activeId);

      if (s.phase === 'show_role') {
        // Le bouton pour avancer ("tout le monde a lu") doit être visible
        // par le HOST quel qu'il soit — y compris quand le rôle secret
        // tombe sur un invité (amActive=false pour le host).
        if (amActive) {
          root.innerHTML = `
            <div class="game-header">
              <div class="game-title">🦎 Caméléon</div>
            </div>
            <div class="game-body slide-up">
              <div class="section-label">TON RÔLE SECRET</div>
              <div class="role-reveal-card" style="--role-color:#7c3aed">
                <span class="role-emoji-lg">🦎</span>
                <div class="role-title-lg">${s.role.role.toUpperCase()}</div>
                <div class="role-desc">${s.role.hint}</div>
                <div style="margin-top:20px;padding:16px;background:rgba(255,255,255,.05);border-radius:12px">
                  <div class="section-label" style="margin-bottom:8px">QUESTION DU TOUR</div>
                  <div style="font-weight:700;font-size:15px">${s.question}</div>
                </div>
              </div>
              <div style="color:var(--muted);font-size:13px;text-align:center;line-height:1.6">
                Réponds <strong style="color:var(--text)">en restant dans ton personnage</strong>.<br>
                Les autres vont essayer de deviner ton rôle !
              </div>
              ${isHost ? `<button class="btn-primary" style="--g1:#7c3aed;--g2:#00aaff"
                onclick="cameleonHostReveal()">TOUT LE MONDE A LU → DEVINER</button>` : `<div class="guest-waiting"><div class="pulse-dot"></div>Attends que le host lance la phase de devine…</div>`}
            </div>
          `;
        } else {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🦎 Caméléon</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">🦎</div>
              <div class="waiting-title">${activeAvatar} ${activeName}</div>
              <div class="waiting-sub">lit son rôle secret…<br>Fermez les yeux !</div>
            </div>
            ${isHost ? `<div style="padding:0 24px"><button class="btn-primary" style="--g1:#7c3aed;--g2:#00aaff"
              onclick="cameleonHostReveal()">TOUT LE MONDE A LU → DEVINER</button></div>` : ''}
          `;
        }
        if (isHost) window.cameleonHostReveal = () => {
          const ns = { ...s, phase: 'guessing', options: _cameleonOptionsFor(s.role), guesses: {}, revealed: false };
          onStateChange(ns); render(ns);
        };

      } else if (s.phase === 'guessing') {
        if (s.revealed) {
          // ── Résultats : qui a deviné quoi, et qui a eu juste ──
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🦎 Caméléon</div></div>
            <div class="game-body slide-up">
              <div class="challenge-card" style="--card-color:#7c3aed">
                <div class="challenge-type">🦎 LE RÔLE ÉTAIT</div>
                <div class="challenge-text"><strong>${s.role.role}</strong></div>
              </div>
              <div class="score-list">
                ${nonActivePlayers.map(p => {
                  const guess = s.guesses[p.id];
                  const correct = guess === s.role.role;
                  return `
                    <div class="score-row">
                      <div style="font-size:20px">${p.avatar}</div>
                      <div class="score-info">
                        <div class="score-name">${p.name}</div>
                        <div style="font-size:11px;color:var(--muted)">${guess ? (correct ? `✅ ${guess}` : `❌ ${guess}`) : '⏳ n\'a pas répondu'}</div>
                      </div>
                      <div class="score-pts">${s.scores[p.id] || 0}</div>
                    </div>
                  `;
                }).join('')}
                <div class="score-row" style="opacity:.8">
                  <div style="font-size:20px">${activeAvatar}</div>
                  <div class="score-info"><div class="score-name">${activeName} (caméléon)</div></div>
                  <div class="score-pts">${s.scores[activeId] || 0}</div>
                </div>
              </div>
              ${isHost ? `<button class="btn-primary" style="--g1:#7c3aed;--g2:#00aaff"
                onclick="cameleonNext()">TOUR SUIVANT →</button>` : `<div class="guest-waiting"><div class="pulse-dot"></div>Attente du host…</div>`}
            </div>
          `;
          if (isHost) window.cameleonNext = () => {
            const newTurn = s.turn + 1;
            if (newTurn >= s.totalRounds) {
              const ns = { ...s, phase: 'scores' };
              onStateChange(ns); render(ns); return;
            }
            const newOrder = s.order;
            const nextActiveId = newOrder[newTurn % newOrder.length];
            const newRole = CAMELEON_ROLES[Math.floor(Math.random()*CAMELEON_ROLES.length)];
            const newQ = CAMELEON_QUESTIONS[Math.floor(Math.random()*CAMELEON_QUESTIONS.length)];
            const ns = { ...s, phase:'show_role', turn:newTurn, activeRolePlayerId:nextActiveId, role:newRole, question:newQ, options:[], guesses:{}, revealed:false };
            onStateChange(ns); render(ns);
          };

        } else {
          // ── Devine en cours : CHAQUE joueur non-actif devine pour lui-même ──
          const myGuess = s.guesses[myId];
          const guessedCount = Object.keys(s.guesses).length;
          const totalGuessers = nonActivePlayers.length;

          root.innerHTML = `
            <div class="game-header"><div class="game-title">🦎 Caméléon</div></div>
            <div class="game-body slide-up">
              <div class="turn-banner">
                <div class="turn-banner-label">EN TRAIN DE RÉPONDRE</div>
                <div class="turn-banner-name">${activeAvatar} ${activeName}</div>
              </div>
              <div class="challenge-card" style="--card-color:#7c3aed">
                <div class="challenge-type">🎯 QUESTION</div>
                <div class="challenge-text">${s.question}</div>
              </div>
              ${amActive ? `
                <div class="guest-waiting"><div class="pulse-dot"></div>Les autres devinent ton rôle… (${guessedCount}/${totalGuessers})</div>
              ` : myGuess ? `
                <div class="guest-waiting"><div class="pulse-dot"></div>Ton choix : <strong style="color:var(--text)">${myGuess}</strong><br>En attente des autres… (${guessedCount}/${totalGuessers})</div>
              ` : `
                <div class="section-label">SELON TOI, QUEL ÉTAIT SON RÔLE ?</div>
                <div class="vote-grid">
                  ${s.options.map(role => `
                    <button class="vote-btn" onclick="cameleonSubmitGuess('${role.replace(/'/g, "\\'")}')">${role}</button>
                  `).join('')}
                </div>
              `}
              ${isHost && guessedCount < totalGuessers ? `
                <button class="btn-secondary" onclick="cameleonForceReveal()">Révéler maintenant (${guessedCount}/${totalGuessers} ont deviné)</button>
              ` : ''}
            </div>
          `;

          // N'importe quel joueur non-actif peut soumettre sa propre
          // réponse — c'était auparavant réservé au host, qui devinait au
          // nom de tout le monde.
          if (!amActive && !myGuess) {
            window.cameleonSubmitGuess = (role) => {
              let ns = { ...s, guesses: { ...s.guesses, [myId]: role } };
              if (Object.keys(ns.guesses).length >= totalGuessers) {
                ns = _cameleonReveal(ns, players);
                Logger.info('cameleon', 'Tous les invités ont deviné — révélation automatique');
              }
              onStateChange(ns); render(ns);
            };
          }
          if (isHost) {
            window.cameleonForceReveal = () => {
              Logger.info('cameleon', 'Révélation forcée par le host', guessedCount, '/', totalGuessers);
              const ns = _cameleonReveal(s, players);
              onStateChange(ns); render(ns);
            };
          }
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => {
            const ns = GameEngines.cameleon.initState(players);
            onStateChange(ns); render(ns);
          } : null,
          onHome: onEnd,
        });
      }

      // Tout le monde s'abonne aux mises à jour temps réel — pas que les
      // invités. Depuis que n'importe quel joueur non-actif peut écrire son
      // propre guess (pas seulement le host), le host doit aussi être
      // notifié pour voir l'avancée des devines des invités en direct.
      _sub = DB.subscribeRoom(Session.room.id, (room) => {
        if (!room.game_state) return;
        Logger.debug('cameleon', 'État reçu', room.game_state.phase);
        try { render(room.game_state); }
        catch (e) { Logger.error('cameleon', 'render() a échoué sur update realtime :', e.message, e.stack); showFatalError(e.message); }
      });
    };

    Logger.info('cameleon', 'mount', { isHost, players: players.length });
    render(state);
  }
};
