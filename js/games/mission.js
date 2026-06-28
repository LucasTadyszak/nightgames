// ══════════════════════════════════════
// games/mission.js
// ══════════════════════════════════════

// Les missions vivent en base (GameContent.missionList, chargées au boot
// — cf. app.js et supabase_seed.sql).

GameEngines['mission'] = {

  initState(players) {
    const shuffledMissions = shuffle(GameContent.missionList);
    const assignments = Object.fromEntries(
      players.map((p, i) => [p.id, {
        mission: shuffledMissions[i % shuffledMissions.length],
        status: 'pending',   // pending | success | failed — déclaré par le joueur lui-même
      }])
    );
    const scores = Object.fromEntries(players.map(p => [p.id, 0]));
    return {
      phase: 'reveal',      // reveal | play | scores
      revealIndex: 0,       // which player is seeing their mission
      revealOrder: players.map(p => p.id),
      assignments,
      scores,
    };
  },

  // mount() retourne sa fonction render : lobby.js gère UN SEUL abonnement
  // Realtime par partie et la rappelle à chaque mise à jour reçue (voir
  // cameleon.js pour le détail du bug que ça évite).
  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('mission', 'mount', { isHost, players: players.length });

    const render = (s) => {
      root.innerHTML = '';
      const g = { color:'#00d4aa', g1:'#00d4aa', g2:'#00aaff' };

      if (s.phase === 'reveal') {
        const currentRevealId = s.revealOrder[s.revealIndex];
        const amRevealing     = me.id === currentRevealId;
        const revealPlayer    = players.find(p => p.id === currentRevealId);

        if (amRevealing) {
          const myMission = s.assignments[me.id].mission;
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🕵️ Mission Impossible</div></div>
            <div class="game-body slide-up">
              <div style="text-align:center;color:var(--muted);font-size:12px;letter-spacing:2px">📵 ÉCRAN PRIVÉ</div>
              <div class="mission-card" data-icon="🕵️" style="border-color:var(--accent3)">
                <div class="mission-status"><div class="pulse-dot"></div>MISSION SECRÈTE</div>
                <div class="mission-text">"${myMission}"</div>
              </div>
              <div style="font-size:13px;color:var(--muted);text-align:center;line-height:1.6">
                Accomplis cette mission <strong style="color:var(--text)">discrètement</strong>.<br>
                Personne ne doit s'en rendre compte !
              </div>
              <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="missionAccept()">
                MISSION ACCEPTÉE ✓
              </button>
            </div>
          `;
          window.missionAccept = () => {
            const nextIdx = s.revealIndex + 1;
            let ns;
            if (nextIdx >= s.revealOrder.length) {
              ns = { ...s, phase: 'play', revealIndex: nextIdx };
            } else {
              ns = { ...s, revealIndex: nextIdx };
            }
            onStateChange(ns); render(ns);
          };
        } else {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🕵️ Mission Impossible</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">🕵️</div>
              <div class="waiting-title">${revealPlayer?.avatar} ${revealPlayer?.name}</div>
              <div class="waiting-sub">reçoit sa mission secrète…<br>Regardez ailleurs !</div>
              <div style="display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px">
                <div class="pulse-dot"></div>Mission ${s.revealIndex + 1} / ${players.length}
              </div>
            </div>
          `;
        }

      } else if (s.phase === 'play') {
        // Chaque joueur déclare lui-même le résultat de SA mission (réussi
        // ou échoué) — avant, seul le host pouvait valider, au nom de tout
        // le monde, sans possibilité d'indiquer un échec.
        // Compat avec un ancien state (avant l'ajout de status) qui
        // utilisait encore `validated: boolean`.
        const assignments = Object.fromEntries(
          Object.entries(s.assignments).map(([pid, a]) => [
            pid,
            a.status ? a : { ...a, status: a.validated ? 'success' : 'pending' },
          ])
        );

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🕵️ Tableau des Missions</div></div>
          <div class="game-body slide-up">
            <div style="font-size:13px;color:var(--muted);text-align:center;line-height:1.6">
              Jouez normalement.<br>Quand ta mission est faite (ou ratée), déclare-la toi-même ci-dessous !
            </div>
            <div style="display:flex;flex-direction:column;gap:10px" id="mission-board">
              ${players.map(p => {
                const a = assignments[p.id];
                const isMe = p.id === me.id;
                const icon = a.status === 'success' ? '✅' : a.status === 'failed' ? '❌' : '🕵️';
                const borderColor = a.status === 'success' ? 'var(--accent3)' : a.status === 'failed' ? '#ff3d6b' : 'var(--border)';
                let detail;
                if (a.status === 'success') detail = `<div style="font-size:12px;color:var(--accent3);margin-top:4px">✅ Mission accomplie — +3 pts</div>`;
                else if (a.status === 'failed') detail = `<div style="font-size:12px;color:#ff3d6b;margin-top:4px">❌ Mission échouée</div>`;
                else detail = `<div style="font-size:12px;color:var(--muted);margin-top:4px">${isMe ? `"${a.mission}"` : '🤫 Mission en cours…'}</div>`;
                return `
                  <div class="mission-card" data-icon="${icon}" style="border-color:${borderColor}">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                      <div>
                        <div style="font-weight:700;font-size:15px">${p.avatar} ${p.name} ${isMe?'(moi)':''}</div>
                        ${detail}
                      </div>
                      ${isMe && a.status === 'pending' ? `
                        <div style="display:flex;gap:6px;flex-shrink:0">
                          <button style="background:var(--accent3);border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:8px 10px;cursor:pointer"
                            onclick="missionMark('success')">✅ Réussi</button>
                          <button style="background:#ff3d6b;border:none;border-radius:10px;color:#fff;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:8px 10px;cursor:pointer"
                            onclick="missionMark('failed')">❌ Raté</button>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            ${isHost ? `
              <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="missionEnd()">
                RÉVÉLER & SCORES FINAUX
              </button>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>La partie est en cours…</div>`}
          </div>
        `;

        // Chaque joueur déclare le résultat de SA PROPRE mission.
        window.missionMark = (status) => {
          const ns = { ...s, assignments: { ...assignments }, scores: { ...s.scores } };
          ns.assignments[me.id] = { ...ns.assignments[me.id], status };
          if (status === 'success') ns.scores[me.id] = (ns.scores[me.id] || 0) + 3;
          Logger.info('mission', 'Mission déclarée', status, 'par', me.id);
          onStateChange(ns); render(ns);
        };
        if (isHost) {
          window.missionEnd = () => {
            const ns = { ...s, assignments, phase:'scores' };
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => { const ns = GameEngines.mission.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

    };

    render(state);
    return render;
  }
};
