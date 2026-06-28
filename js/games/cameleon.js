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
      guessResult: null,
      totalRounds: players.length * 2,
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    let _sub = null;
    // IMPORTANT : on désabonne au début de chaque render(), sinon chaque
    // mise à jour du host empile une nouvelle souscription Realtime côté
    // guest (fuite de listeners + rendus en double / désynchronisés).
    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
      root.innerHTML = '';
      const myId = me.id;
      const activeId = s.activeRolePlayerId;
      const amActive = myId === activeId;
      const activeName = players.find(p => p.id === activeId)?.name || '?';
      const activeAvatar = players.find(p => p.id === activeId)?.avatar || '?';

      if (s.phase === 'show_role') {
        if (amActive) {
          // Show MY role
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
                onclick="cameleonHostReveal()">TOUT LE MONDE A LU → DEVINER</button>` : ''}
            </div>
          `;
          if (isHost) window.cameleonHostReveal = () => {
            const ns = { ...s, phase: 'guessing' };
            onStateChange(ns); render(ns);
          };
        } else {
          // Waiting screen for other players
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🦎 Caméléon</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">🦎</div>
              <div class="waiting-title">${activeAvatar} ${activeName}</div>
              <div class="waiting-sub">lit son rôle secret…<br>Fermez les yeux !</div>
            </div>
          `;
        }

      } else if (s.phase === 'guessing') {
        // Everyone sees the question and can guess
        // Only host controls the result
        const wrongOptions = shuffle(CAMELEON_ROLES.filter(r => r.role !== s.role.role)).slice(0,3);
        const options = shuffle([s.role, ...wrongOptions]);

        if (s.guessResult !== null) {
          // Result revealed
          const correct = s.guessResult;
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🦎 Caméléon</div></div>
            <div class="game-body slide-up">
              <div class="challenge-card" style="--card-color:${correct?'#00d4aa':'#ff3d6b'}">
                <div class="challenge-type">${correct ? '✅ BIEN DEVINÉ !' : '❌ RATÉ !'}</div>
                <div class="challenge-text">Le rôle était :<br><strong>${s.role.role}</strong></div>
              </div>
              <div class="score-list">
                ${players.map(p => `
                  <div class="score-row">
                    <div style="font-size:20px">${p.avatar}</div>
                    <div class="score-info"><div class="score-name">${p.name}</div></div>
                    <div class="score-pts">${s.scores[p.id] || 0}</div>
                  </div>
                `).join('')}
              </div>
              ${isHost ? `<button class="btn-primary" style="--g1:#7c3aed;--g2:#00aaff"
                onclick="cameleonNext()">TOUR SUIVANT →</button>` : `<div class="guest-waiting"><div class="pulse-dot"></div>Attente du host…</div>`}
            </div>
          `;
          if (isHost) window.cameleonNext = () => {
            const newTurn = s.turn + 1;
            if (newTurn >= s.totalRounds) {
              const ns = { ...s, phase: 'scores', guessResult: null };
              onStateChange(ns); render(ns); return;
            }
            const newOrder = s.order;
            const nextActiveId = newOrder[newTurn % newOrder.length];
            const newRole = CAMELEON_ROLES[Math.floor(Math.random()*CAMELEON_ROLES.length)];
            const newQ = CAMELEON_QUESTIONS[Math.floor(Math.random()*CAMELEON_QUESTIONS.length)];
            const ns = { ...s, phase:'show_role', turn:newTurn, activeRolePlayerId:nextActiveId, role:newRole, question:newQ, guessResult:null };
            onStateChange(ns); render(ns);
          };
        } else {
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
              ${isHost ? `
                <div class="section-label">QUEL ÉTAIT SON RÔLE ? (host révèle le résultat)</div>
                <div class="vote-grid">
                  ${options.map(o => `
                    <button class="vote-btn" onclick="cameleonGuess('${o.role}')">${o.role}</button>
                  `).join('')}
                </div>
                <button class="btn-secondary" onclick="cameleonNoGuess()">Personne n'a deviné</button>
              ` : `<div class="guest-waiting"><div class="pulse-dot"></div>Écoutez ${activeName} et devinez !</div>`}
            </div>
          `;
          if (isHost) {
            window.cameleonGuess = (guess) => {
              const correct = guess === s.role.role;
              let ns = { ...s };
              if (correct) {
                players.forEach(p => { if (p.id !== activeId) ns.scores[p.id] = (ns.scores[p.id]||0)+1; });
              } else {
                ns.scores[activeId] = (ns.scores[activeId]||0)+2;
              }
              ns.guessResult = correct;
              onStateChange(ns); render(ns);
            };
            window.cameleonNoGuess = () => {
              let ns = { ...s };
              ns.scores[activeId] = (ns.scores[activeId]||0)+2;
              ns.guessResult = false;
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

      // Subscribe non-host to state changes (juste re-render, jamais re-mount)
      if (!isHost) {
        _sub = DB.subscribeRoom(Session.room.id, (room) => {
          if (!room.game_state) return;
          Logger.debug('cameleon', 'État reçu du host', room.game_state.phase);
          try { render(room.game_state); }
          catch (e) { Logger.error('cameleon', 'render() a échoué sur update realtime :', e.message, e.stack); showFatalError(e.message); }
        });
      }
    };

    Logger.info('cameleon', 'mount', { isHost, players: players.length });
    render(state);
  }
};
