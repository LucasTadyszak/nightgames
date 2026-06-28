// ══════════════════════════════════════
// games/cameleon.js
// ══════════════════════════════════════

// Les rôles et questions vivent en base (GameContent.cameleonRoles /
// GameContent.cameleonQuestions, chargés au boot — cf. app.js et
// supabase_seed.sql) au lieu d'être codés en dur ici.

// Liste les joueurs de `pool` dont l'id n'apparaît pas dans `doneMap`,
// pour afficher "en attente de Léo, Sam" plutôt qu'un simple compteur.
function _cameleonPending(pool, doneMap) {
  return pool.filter(p => !doneMap[p.id]).map(p => `${p.avatar} ${p.name}`).join(', ');
}

function _cameleonOptionsFor(role) {
  const wrongOptions = shuffle(GameContent.cameleonRoles.filter(r => r.role !== role.role)).slice(0, 3);
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
    const role = GameContent.cameleonRoles[Math.floor(Math.random() * GameContent.cameleonRoles.length)];
    const question = GameContent.cameleonQuestions[Math.floor(Math.random() * GameContent.cameleonQuestions.length)];
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
      ready: {},           // playerId -> true : a confirmé être prêt à deviner (un par joueur non-actif)
      totalRounds: players.length * 2,
    };
  },

  // mount() retourne sa fonction render : lobby.js gère UN SEUL abonnement
  // Realtime par partie (et non un par jeu) et la rappelle à chaque mise à
  // jour reçue, pour éviter de recréer/détruire des canaux Supabase à
  // chaque rendu (cause de "cannot add postgres_changes callbacks ...
  // after subscribe()" — removeChannel() est asynchrone côté supabase-js).
  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    const render = (s) => {
      // Tolère un state persisté par une version antérieure du jeu
      // (avant l'ajout de guesses/options/revealed) pour ne pas planter
      // sur une partie déjà en cours au moment de la mise à jour.
      s = { options: [], guesses: {}, revealed: false, ready: {}, ...s };
      root.innerHTML = '';
      const myId = me.id;
      const activeId = s.activeRolePlayerId;
      const amActive = myId === activeId;
      const activeName = players.find(p => p.id === activeId)?.name || '?';
      const activeAvatar = players.find(p => p.id === activeId)?.avatar || '?';
      const nonActivePlayers = players.filter(p => p.id !== activeId);

      if (s.phase === 'show_role') {
        // Chaque joueur non-actif donne SON propre accord ("j'ai vu / je suis
        // prêt") au lieu que le host décide seul pour tout le monde. On passe
        // à la phase de devine automatiquement quand tous ont confirmé.
        const readyCount = Object.keys(s.ready).length;
        const totalReady = nonActivePlayers.length;
        const iAmReady = !!s.ready[myId];
        const pendingReadyNames = _cameleonPending(nonActivePlayers, s.ready);

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
              <div class="guest-waiting"><div class="pulse-dot"></div>En attente que tout le monde soit prêt… (${readyCount}/${totalReady})${pendingReadyNames ? `<br><span style="font-size:12px">⏳ ${pendingReadyNames}</span>` : ''}</div>
              ${isHost && readyCount < totalReady ? `<button class="btn-secondary" onclick="cameleonForceStartGuessing()">Lancer maintenant — manque ${pendingReadyNames}</button>` : ''}
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
            <div style="padding:0 24px;display:flex;flex-direction:column;gap:10px">
              ${iAmReady
                ? `<div class="guest-waiting"><div class="pulse-dot"></div>C'est noté ! En attente des autres… (${readyCount}/${totalReady})${pendingReadyNames ? `<br><span style="font-size:12px">⏳ ${pendingReadyNames}</span>` : ''}</div>`
                : `<button class="btn-primary" style="--g1:#7c3aed;--g2:#00aaff" onclick="cameleonConfirmReady()">✅ J'ai vu, prêt à deviner !</button>`}
              ${isHost && readyCount < totalReady ? `<button class="btn-secondary" onclick="cameleonForceStartGuessing()">Lancer maintenant — manque ${pendingReadyNames}</button>` : ''}
            </div>
          `;
        }

        // N'importe quel joueur non-actif confirme pour lui-même.
        if (!amActive && !iAmReady) {
          window.cameleonConfirmReady = () => {
            let ns = { ...s, ready: { ...s.ready, [myId]: true } };
            if (Object.keys(ns.ready).length >= totalReady) {
              Logger.info('cameleon', 'Tout le monde est prêt — passage à la devine');
              ns = { ...ns, phase: 'guessing', options: _cameleonOptionsFor(ns.role), guesses: {}, revealed: false };
            }
            onStateChange(ns); render(ns);
          };
        }
        // Garde-fou côté host si quelqu'un ne répond pas.
        if (isHost && readyCount < totalReady) {
          window.cameleonForceStartGuessing = () => {
            Logger.info('cameleon', 'Passage forcé à la devine par le host', readyCount, '/', totalReady);
            const ns = { ...s, phase: 'guessing', options: _cameleonOptionsFor(s.role), guesses: {}, revealed: false };
            onStateChange(ns); render(ns);
          };
        }

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
            const newRole = GameContent.cameleonRoles[Math.floor(Math.random()*GameContent.cameleonRoles.length)];
            const newQ = GameContent.cameleonQuestions[Math.floor(Math.random()*GameContent.cameleonQuestions.length)];
            const ns = { ...s, phase:'show_role', turn:newTurn, activeRolePlayerId:nextActiveId, role:newRole, question:newQ, options:[], guesses:{}, revealed:false, ready:{} };
            onStateChange(ns); render(ns);
          };

        } else {
          // ── Devine en cours : CHAQUE joueur non-actif devine pour lui-même ──
          const myGuess = s.guesses[myId];
          const guessedCount = Object.keys(s.guesses).length;
          const totalGuessers = nonActivePlayers.length;
          const pendingGuessNames = _cameleonPending(nonActivePlayers, s.guesses);

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
                <div class="guest-waiting"><div class="pulse-dot"></div>Les autres devinent ton rôle… (${guessedCount}/${totalGuessers})${pendingGuessNames ? `<br><span style="font-size:12px">⏳ ${pendingGuessNames}</span>` : ''}</div>
              ` : myGuess ? `
                <div class="guest-waiting"><div class="pulse-dot"></div>Ton choix : <strong style="color:var(--text)">${myGuess}</strong><br>En attente des autres… (${guessedCount}/${totalGuessers})${pendingGuessNames ? `<br><span style="font-size:12px">⏳ ${pendingGuessNames}</span>` : ''}</div>
              ` : `
                <div class="section-label">SELON TOI, QUEL ÉTAIT SON RÔLE ?</div>
                <div class="vote-grid">
                  ${s.options.map(role => `
                    <button class="vote-btn" onclick="cameleonSubmitGuess('${role.replace(/'/g, "\\'")}')">${role}</button>
                  `).join('')}
                </div>
              `}
              ${isHost && guessedCount < totalGuessers ? `
                <button class="btn-secondary" onclick="cameleonForceReveal()">Révéler maintenant — manque ${pendingGuessNames}</button>
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

    };

    Logger.info('cameleon', 'mount', { isHost, players: players.length });
    render(state);
    return render;
  }
};
