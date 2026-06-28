// ══════════════════════════════════════
// games/verite.js
// ══════════════════════════════════════

const VERITE_DATA = {
  verite: [
    'Quelle est la chose la plus embarrassante que tu aies faite en public ?',
    'Quel est ton plus grand mensonge qui a réussi ?',
    'Qui dans ce groupe t\'agace le plus parfois ?',
    'Quel secret tu n\'aurais jamais pensé révéler ce soir ?',
    'Quelle est la chose la plus folle que tu aies faite pour quelqu\'un ?',
    'Quelle appli sur ton téléphone tu ne montrerais jamais à tes parents ?',
    'Quel est ton pire souvenir de soirée ?',
    'Décris ta pire date en une phrase.',
  ],
  defi: [
    'Appelle quelqu\'un que tu n\'as pas contacté depuis 6 mois et parle 30 secondes.',
    'Imite quelqu\'un dans ce groupe — les autres doivent deviner.',
    'Fais 10 pompes ou bois une gorgée par pompe manquée.',
    'Raconte la blague la plus nulle que tu connaisses avec le plus grand sérieux.',
    'Fais semblant de pleurer en racontant un fait absolument banal.',
    'Envoie un message mystérieux à la dernière personne de tes contacts.',
    'Change ton statut WhatsApp pour 1h selon ce que le groupe décide.',
    'Pose une question absurde à quelqu\'un hors du groupe (appel ou message).',
  ],
};

GameEngines['verite'] = {

  initState(players) {
    const order = [...players.map(p => p.id)];
    const scores = Object.fromEntries(players.map(p => [p.id, 0]));
    return {
      phase: 'choose',   // choose | card | scores
      turnIndex: 0,
      order,
      activePlayerId: order[0],
      cardType: null,    // 'verite' | 'defi'
      cardText: null,
      scores,
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('verite', 'mount', { isHost, players: players.length });
    let _sub = null;

    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
      root.innerHTML = '';
      const activeId   = s.activePlayerId;
      const active     = players.find(p => p.id === activeId);
      const amActive   = me.id === activeId;
      const g          = { color:'#ff3d6b', g1:'#ff3d6b', g2:'#ff9500' };

      if (s.phase === 'choose') {
        if (amActive) {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🔥 Vérité ou Défi</div></div>
            <div class="game-body slide-up">
              <div class="turn-banner">
                <div class="turn-banner-label">TON TOUR</div>
                <div class="turn-banner-name">${active?.avatar} ${active?.name}</div>
              </div>
              <div class="section-label" style="text-align:center">Que choisis-tu ?</div>
              <div class="btn-row">
                <button class="btn-primary" style="--g1:#ff3d6b;--g2:#ff9500;padding:24px;font-size:22px" onclick="vtChoose('verite')">🗣️<br>VÉRITÉ</button>
                <button class="btn-primary" style="--g1:#7c3aed;--g2:#00aaff;padding:24px;font-size:22px" onclick="vtChoose('defi')">💥<br>DÉFI</button>
              </div>
            </div>
          `;
          window.vtChoose = (type) => {
            const pool = VERITE_DATA[type];
            const text = pool[Math.floor(Math.random()*pool.length)];
            const ns = { ...s, phase:'card', cardType:type, cardText:text };
            onStateChange(ns); render(ns);
          };
        } else {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🔥 Vérité ou Défi</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">${active?.avatar}</div>
              <div class="waiting-title">${active?.name}</div>
              <div class="waiting-sub">choisit entre Vérité ou Défi…</div>
              <div style="display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px"><div class="pulse-dot"></div>En attente</div>
            </div>
          `;
        }

      } else if (s.phase === 'card') {
        const isVerite = s.cardType === 'verite';
        const cardColor = isVerite ? '#ff3d6b' : '#7c3aed';
        root.innerHTML = `
          <div class="game-header"><div class="game-title">${isVerite?'🗣️ Vérité':'💥 Défi'}</div></div>
          <div class="game-body slide-up">
            <div class="challenge-card" style="--card-color:${cardColor}">
              <div class="challenge-type">${isVerite?'🗣️ QUESTION POUR':'💥 DÉFI POUR'}</div>
              <div style="margin-bottom:12px"><span class="player-tag" style="background:${cardColor}">${active?.avatar} ${active?.name}</span></div>
              <div class="challenge-text">${s.cardText}</div>
            </div>
            ${isHost ? `
              <div class="btn-row">
                <button class="btn-primary" style="--g1:#00d4aa;--g2:#00aaff" onclick="vtResult(true)">✅ Réussi ! (+2pts)</button>
                <button class="btn-secondary" onclick="vtResult(false)">❌ Refusé</button>
              </div>
            ` : `
              <div class="guest-waiting"><div class="pulse-dot"></div>${isHost?'':'Attente du résultat…'}</div>
            `}
            <div class="score-list">
              ${players.map(p => `
                <div class="score-row">
                  <div style="font-size:20px">${p.avatar}</div>
                  <div class="score-info"><div class="score-name">${p.name}</div></div>
                  <div class="score-pts">${s.scores[p.id]||0}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
        if (isHost) {
          window.vtResult = (success) => {
            let ns = { ...s, scores:{...s.scores} };
            if (success) ns.scores[activeId] = (ns.scores[activeId]||0) + 2;
            // Next player
            const nextIdx = (s.turnIndex + 1) % players.length;
            ns.phase        = 'choose';
            ns.turnIndex    = nextIdx;
            ns.activePlayerId = s.order[nextIdx];
            ns.cardType     = null; ns.cardText = null;
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => { const ns = GameEngines.verite.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

      // Guests subscribe to state push
      if (!isHost) {
        _sub = DB.subscribeRoom(Session.room.id, (room) => {
          if (!room.game_state) return;
          Logger.debug('verite', 'État reçu', room.game_state.phase);
          try { render(room.game_state); }
          catch (e) { Logger.error('verite', 'render() a échoué sur update realtime :', e.message, e.stack); showFatalError(e.message); }
        });
      }
    };

    render(state);
  }
};
