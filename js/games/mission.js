// ══════════════════════════════════════
// games/mission.js
// ══════════════════════════════════════

const MISSIONS_LIST = [
  'Fais dire le mot "banane" à quelqu\'un sans qu\'il s\'en rende compte.',
  'Convaincs quelqu\'un de changer de place avec toi.',
  'Fais rire quelqu\'un en moins de 30 secondes — 3 fois dans la soirée.',
  'Obtiens un high-five de chaque joueur sans que ça semble forcé.',
  'Pose la même question bizarre à 3 personnes différentes.',
  'Convaincs quelqu\'un de faire quelque chose qu\'il ne voulait pas faire.',
  'Mentionne un pays imaginaire dans une vraie conversation.',
  'Fais semblant de chercher quelque chose toute la soirée sans explication.',
  'Utilise le mot "manifestement" dans toutes tes phrases pendant 5 minutes.',
  'Fais dire "oui" à quelqu\'un 5 fois de suite avant qu\'il réalise.',
];

GameEngines['mission'] = {

  initState(players) {
    const shuffledMissions = shuffle(MISSIONS_LIST);
    const assignments = Object.fromEntries(
      players.map((p, i) => [p.id, {
        mission: shuffledMissions[i % shuffledMissions.length],
        validated: false,
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

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('mission', 'mount', { isHost, players: players.length });
    let _sub = null;
    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
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
        // Board view — everyone sees all missions (blurred if not validated)
        root.innerHTML = `
          <div class="game-header"><div class="game-title">🕵️ Tableau des Missions</div></div>
          <div class="game-body slide-up">
            <div style="font-size:13px;color:var(--muted);text-align:center;line-height:1.6">
              Jouez normalement.<br>Quand quelqu'un accomplit sa mission, appuyez sur son nom !
            </div>
            <div style="display:flex;flex-direction:column;gap:10px" id="mission-board">
              ${players.map(p => {
                const a = s.assignments[p.id];
                const isMe = p.id === me.id;
                return `
                  <div class="mission-card" data-icon="${a.validated?'✅':'🕵️'}"
                    style="border-color:${a.validated?'var(--accent3)':'var(--border)'}">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                      <div>
                        <div style="font-weight:700;font-size:15px">${p.avatar} ${p.name} ${isMe?'(moi)':''}</div>
                        ${a.validated
                          ? `<div style="font-size:12px;color:var(--accent3);margin-top:4px">✅ Mission accomplie — +3 pts</div>`
                          : `<div style="font-size:12px;color:var(--muted);margin-top:4px">${isMe ? `"${a.mission}"` : '🤫 Mission en cours…'}</div>`}
                      </div>
                      ${!a.validated && isHost ? `
                        <button style="background:var(--accent3);border:none;border-radius:10px;color:#000;font-family:'Syne',sans-serif;font-weight:700;font-size:12px;padding:8px 12px;cursor:pointer;flex-shrink:0"
                          onclick="missionValidate('${p.id}')">Valider !</button>
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
        if (isHost) {
          window.missionValidate = (pid) => {
            const ns = { ...s, assignments:{...s.assignments}, scores:{...s.scores} };
            ns.assignments[pid] = { ...ns.assignments[pid], validated:true };
            ns.scores[pid] = (ns.scores[pid]||0) + 3;
            onStateChange(ns); render(ns);
          };
          window.missionEnd = () => {
            const ns = { ...s, phase:'scores' };
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => { const ns = GameEngines.mission.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

      if (!isHost) {
        _sub = DB.subscribeRoom(Session.room.id, (room) => {
          if (room.game_state) render(room.game_state);
        });
      }
    };

    render(state);
  }
};
