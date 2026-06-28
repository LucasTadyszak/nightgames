// ══════════════════════════════════════
// games/verite.js
// ══════════════════════════════════════

// Les cartes vivent en base (GameContent.veriteCards.{verite,defi},
// chargées au boot — cf. app.js et supabase_seed.sql).

GameEngines['verite'] = {

  initState(players) {
    const order = [...players.map(p => p.id)];
    const scores = Object.fromEntries(players.map(p => [p.id, 0]));
    return {
      phase: 'choose',   // choose | card | scores
      turnIndex: 0,
      turnsPlayed: 0,
      totalTurns: players.length * 3,   // ~3 tours par joueur avant les scores finaux
      order,
      activePlayerId: order[0],
      cardType: null,    // 'verite' | 'defi'
      cardText: null,
      scores,
    };
  },

  // mount() retourne sa fonction render : lobby.js gère UN SEUL abonnement
  // Realtime par partie et la rappelle à chaque mise à jour reçue (voir
  // cameleon.js pour le détail du bug que ça évite).
  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('verite', 'mount', { isHost, players: players.length });

    const render = (s) => {
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
              ${isHost ? `<button class="btn-secondary" id="vt-btn-end" style="margin-top:4px">🏁 Terminer la partie</button>` : ''}
            </div>
          `;
          window.vtChoose = (type) => {
            const pool = GameContent.veriteCards[type];
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
            ${isHost ? `<div style="padding:0 24px"><button class="btn-secondary" id="vt-btn-end">🏁 Terminer la partie</button></div>` : ''}
          `;
        }
        if (isHost) {
          root.querySelector('#vt-btn-end')?.addEventListener('click', () => {
            Logger.info('verite', 'Fin de partie demandée par le host (manuel)');
            const ns = { ...s, phase: 'scores', cardType: null, cardText: null };
            onStateChange(ns); render(ns);
          });
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
              <button class="btn-secondary" id="vt-btn-end">🏁 Terminer la partie</button>
            ` : `
              <div class="guest-waiting"><div class="pulse-dot"></div>Attente du résultat…</div>
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

            const turnsPlayed = s.turnsPlayed + 1;
            ns.turnsPlayed = turnsPlayed;

            if (turnsPlayed >= s.totalTurns) {
              ns.phase = 'scores';
              ns.cardType = null; ns.cardText = null;
              Logger.info('verite', 'Fin de partie après', turnsPlayed, 'tours');
              onStateChange(ns); render(ns); return;
            }

            // Next player
            const nextIdx = (s.turnIndex + 1) % players.length;
            ns.phase        = 'choose';
            ns.turnIndex    = nextIdx;
            ns.activePlayerId = s.order[nextIdx];
            ns.cardType     = null; ns.cardText = null;
            onStateChange(ns); render(ns);
          };
          root.querySelector('#vt-btn-end')?.addEventListener('click', () => {
            Logger.info('verite', 'Fin de partie demandée par le host (manuel)');
            const ns = { ...s, scores:{...s.scores}, phase: 'scores', cardType: null, cardText: null };
            onStateChange(ns); render(ns);
          });
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => { const ns = GameEngines.verite.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

    };

    render(state);
    return render;
  }
};
