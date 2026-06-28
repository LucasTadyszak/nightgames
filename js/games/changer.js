// ══════════════════════════════════════
// games/changer.js
// ══════════════════════════════════════

const CHANGER_RULES = [
  { icon:'⚡', name:'SPEED ROUND',          rule:'Le premier à taper sur la table après chaque question marque 1 pt. Si tu te trompes de réponse, tu perds 2 pts !', action:'Posez-vous des questions de culture générale.' },
  { icon:'🤫', name:'CHUCHOTEUR',           rule:'TOUT LE MONDE doit chuchoter. Parler normalement = −1 pt. Le dernier à parler fort est éliminé.', action:'Continuez à jouer normalement mais en chuchotant.' },
  { icon:'🔄', name:'MIROIR',               rule:'Tout ce qu\'un joueur fait, son voisin de gauche doit l\'imiter exactement. Rater = −1 pt.', action:'Essayez de piéger votre voisin avec des gestes compliqués.' },
  { icon:'🎭', name:'INTERDIT DE RIRE',     rule:'Personne ne doit sourire. Le premier qui rit donne 3 pts à tous les autres. Durée : 2 minutes.', action:'Essayez de faire rire les autres sans sourire vous-même.' },
  { icon:'📱', name:'SANS LES MAINS',       rule:'Vous ne pouvez pas utiliser vos mains. Utiliser ses mains = −2 pts.', action:'Accomplissez des défis sans utiliser vos mains.' },
  { icon:'🔢', name:'CHIFFRES INTERDITS',   rule:'Remplacez tous les chiffres par "BZZZ". Dire un chiffre = −1 pt. Durée : 3 minutes.', action:'Discutez normalement en censurant chaque chiffre.' },
  { icon:'🎤', name:'MICRO OUVERT',         rule:'Tout ce que tu penses, tu dois le dire à voix haute. Rester silencieux = −1 pt.', action:'Chaque pensée doit être vocalisée !' },
  { icon:'🕺', name:'DANSE OBLIGATOIRE',    rule:'À chaque fois qu\'on dit le mot "je", tout le monde doit danser 3 secondes. Oublier = −1 pt.', action:'Discutez normalement en surveillant le mot "je".' },
];

GameEngines['changer'] = {

  initState(players) {
    const ruleIdx = Math.floor(Math.random()*CHANGER_RULES.length);
    const scores  = Object.fromEntries(players.map(p=>[p.id,0]));
    return {
      phase: 'reveal',    // reveal | play | adjust | scores
      ruleIdx,
      round: 1,
      revealed: false,
      scores,
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('changer', 'mount', { isHost, players: players.length });
    let _sub = null;
    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
      root.innerHTML='';
      const rule = CHANGER_RULES[s.ruleIdx];
      const g = { g1:'#ff6b35', g2:'#7c3aed' };

      if (s.phase === 'reveal' || (!s.revealed && s.phase==='reveal')) {
        root.innerHTML=`
          <div class="game-header"><div class="game-title">🎲 Game Changer — Manche ${s.round}</div></div>
          <div class="game-body slide-up">
            <div class="rule-card">
              <div class="rule-icon-lg ${s.revealed?'':'blurred'}">${rule.icon}</div>
              <div class="rule-name ${s.revealed?'':'blurred'}">${rule.name}</div>
              <div class="rule-text ${s.revealed?'':'blurred'}">${s.revealed ? rule.rule : '???'}</div>
            </div>
            ${isHost && !s.revealed ? `
              <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="changerReveal()">
                🎲 RÉVÉLER LA RÈGLE !
              </button>` : ''}
            ${s.revealed && isHost ? `
              <div style="background:rgba(255,107,53,.1);border:1px solid var(--accent6);border-radius:var(--r-lg);padding:20px;text-align:center">
                <div class="section-label" style="margin-bottom:8px">COMMENT JOUER</div>
                <div style="font-size:15px;font-weight:700">${rule.action}</div>
              </div>
              <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="changerPlay()">
                C'EST PARTI ! →
              </button>` : ''}
            ${!isHost ? `<div class="guest-waiting"><div class="pulse-dot"></div>${s.revealed?'La règle est révélée !':'Le host révèle la règle…'}</div>` : ''}
          </div>
        `;
        if (isHost) {
          window.changerReveal = () => {
            const ns = {...s, revealed:true};
            onStateChange(ns); render(ns);
          };
          window.changerPlay = () => {
            const ns = {...s, phase:'play'};
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'play') {
        root.innerHTML=`
          <div class="game-header"><div class="game-title">🎲 ${rule.name}</div></div>
          <div class="game-body slide-up">
            <div class="rule-card">
              <div class="rule-icon-lg">${rule.icon}</div>
              <div class="rule-name">${rule.name}</div>
              <div class="rule-text">${rule.rule}</div>
            </div>
            <div style="background:rgba(255,107,53,.1);border:1px solid var(--accent6);border-radius:var(--r-lg);padding:16px;text-align:center">
              <div style="font-size:15px;font-weight:700">${rule.action}</div>
            </div>
            ${isHost ? `<button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="changerAdjust()">
              📊 ATTRIBUER LES POINTS
            </button>` : `<div class="guest-waiting"><div class="pulse-dot"></div>La manche est en cours…</div>`}
          </div>
        `;
        if (isHost) window.changerAdjust = () => { const ns={...s,phase:'adjust'}; onStateChange(ns); render(ns); };

      } else if (s.phase === 'adjust') {
        root.innerHTML=`
          <div class="game-header"><div class="game-title">📊 Scores Manche ${s.round}</div></div>
          <div class="game-body slide-up">
            <div class="section-label">Ajustez les points</div>
            ${isHost ? `
              <div style="display:flex;flex-direction:column;gap:10px">
                ${players.map(p=>`
                  <div class="score-row">
                    <div style="font-size:22px">${p.avatar}</div>
                    <div class="score-info"><div class="score-name">${p.name}</div></div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <button onclick="changerDelta('${p.id}',-1)" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:10px;font-size:20px;cursor:pointer">−</button>
                      <div id="cpts-${p.id}" style="font-family:'Space Mono',monospace;font-size:18px;font-weight:700;color:var(--accent3);min-width:36px;text-align:center">${s.scores[p.id]||0}</div>
                      <button onclick="changerDelta('${p.id}',1)" style="background:var(--accent6);border:none;color:white;width:36px;height:36px;border-radius:10px;font-size:20px;cursor:pointer">+</button>
                    </div>
                  </div>
                `).join('')}
              </div>
              <div class="btn-row">
                <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="changerNextRound()">MANCHE SUIVANTE 🎲</button>
                <button class="btn-secondary" onclick="changerEndGame()">Fin de partie</button>
              </div>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>Attribution des points…</div>`}
          </div>
        `;

        // Keep local scores ref for live +/- (host only)
        let localScores = {...s.scores};
        if (isHost) {
          window.changerDelta = (pid, d) => {
            localScores[pid] = Math.max(0, (localScores[pid]||0)+d);
            document.getElementById(`cpts-${pid}`).textContent = localScores[pid];
          };
          window.changerNextRound = () => {
            let nextRuleIdx;
            do { nextRuleIdx = Math.floor(Math.random()*CHANGER_RULES.length); }
            while (nextRuleIdx === s.ruleIdx);
            const ns = { ruleIdx:nextRuleIdx, round:s.round+1, phase:'reveal', revealed:false, scores:localScores };
            onStateChange(ns); render(ns);
          };
          window.changerEndGame = () => {
            const ns = {...s, phase:'scores', scores:localScores};
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => { const ns=GameEngines.changer.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

      if (!isHost) {
        _sub = DB.subscribeRoom(Session.room.id, (room)=>{ if(room.game_state) render(room.game_state); });
      }
    };

    render(state);
  }
};
