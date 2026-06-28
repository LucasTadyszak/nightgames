// ══════════════════════════════════════
// games/famille.js
// ══════════════════════════════════════

const FAMILLE_QUESTIONS = [
  { q:'Nommez quelque chose qu\'on oublie toujours de ranger',
    answers:[{t:'Les clés',pts:32},{t:'Le chargeur',pts:24},{t:'Les lunettes',pts:18},{t:'Le portefeuille',pts:14},{t:'Les écouteurs',pts:12}] },
  { q:'Nommez une excuse pour ne pas aller au sport',
    answers:[{t:'J\'ai mal quelque part',pts:35},{t:'Il pleut',pts:22},{t:'Je suis fatigué(e)',pts:20},{t:'Je commence lundi',pts:15},{t:'J\'ai trop mangé',pts:8}] },
  { q:'Nommez quelque chose que les gens font sur leur téléphone en soirée',
    answers:[{t:'Scroller les réseaux',pts:40},{t:'Filmer/prendre des photos',pts:28},{t:'Envoyer des messages',pts:18},{t:'Regarder des stories',pts:9},{t:'Appeler quelqu\'un',pts:5}] },
  { q:'Nommez une raison de ne pas répondre à un message',
    answers:[{t:'J\'ai oublié',pts:38},{t:'Je ne savais pas quoi dire',pts:26},{t:'J\'étais occupé(e)',pts:20},{t:'Je dormais',pts:10},{t:'Je ne voulais pas',pts:6}] },
  { q:'Nommez quelque chose que les gens font secrètement',
    answers:[{t:'Manger en cachette',pts:35},{t:'Stalker les réseaux',pts:28},{t:'Chanter sous la douche',pts:20},{t:'Parler tout seul',pts:12},{t:'Lire les horoscopes',pts:5}] },
];

GameEngines['famille'] = {

  initState(players) {
    const qIdx = Math.floor(Math.random() * FAMILLE_QUESTIONS.length);
    const scores = Object.fromEntries(players.map(p => [p.id, 0]));
    return {
      phase: 'play',    // play | scores
      questionIdx: qIdx,
      revealed: [],     // indices of revealed answers
      questionCount: 0,
      scores,
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('famille', 'mount', { isHost, players: players.length });
    let _sub = null;
    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
      root.innerHTML = '';
      const g = { g1:'#ff9500', g2:'#ff3d6b' };

      if (s.phase === 'play') {
        const q = FAMILLE_QUESTIONS[s.questionIdx];
        root.innerHTML = `
          <div class="game-header"><div class="game-title">🏆 Une Famille en Or</div></div>
          <div class="game-body slide-up">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(18px,5vw,26px);text-align:center;line-height:1.3;padding:20px;background:var(--surface);border-radius:var(--r-lg);border:1px solid var(--border)">
              ${q.q}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${q.answers.map((a, i) => `
                <div class="answer-row ${s.revealed.includes(i)?'revealed':''}"
                  ${isHost && !s.revealed.includes(i) ? `onclick="familleReveal(${i})"` : ''}>
                  <div class="answer-num">${i+1}</div>
                  <div class="answer-text">${s.revealed.includes(i) ? a.t : '???'}</div>
                  <div class="answer-pts">${s.revealed.includes(i) ? `+${a.pts}` : '🔒'}</div>
                </div>
              `).join('')}
            </div>
            ${isHost ? `
              <div class="btn-row">
                <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="familleRevealAll()">Tout révéler</button>
                <button class="btn-secondary" onclick="familleNext()">Question suivante →</button>
              </div>
              <div style="font-size:12px;color:var(--muted);text-align:center">Appuyez sur une réponse pour la révéler</div>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>Le host révèle les réponses…</div>`}
            <div class="score-list">
              ${players.map(p=>`
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
          window.familleReveal = (idx) => {
            if (s.revealed.includes(idx)) return;
            const q = FAMILLE_QUESTIONS[s.questionIdx];
            const pts = q.answers[idx].pts;
            const ns = { ...s, revealed:[...s.revealed, idx], scores:{...s.scores} };
            // Add points to everyone (team mode simplified: all share)
            players.forEach(p => { ns.scores[p.id] = (ns.scores[p.id]||0) + Math.round(pts/players.length); });
            onStateChange(ns); render(ns);
          };
          window.familleRevealAll = () => {
            const q = FAMILLE_QUESTIONS[s.questionIdx];
            let ns = { ...s, scores:{...s.scores} };
            q.answers.forEach((a, i) => {
              if (!s.revealed.includes(i)) {
                players.forEach(p => { ns.scores[p.id] = (ns.scores[p.id]||0) + Math.round(a.pts/players.length); });
              }
            });
            ns.revealed = q.answers.map((_,i)=>i);
            onStateChange(ns); render(ns);
          };
          window.familleNext = () => {
            if (s.questionCount >= 4) {
              const ns = { ...s, phase:'scores' };
              onStateChange(ns); render(ns); return;
            }
            let nextIdx;
            do { nextIdx = Math.floor(Math.random()*FAMILLE_QUESTIONS.length); }
            while (nextIdx === s.questionIdx);
            const ns = { ...s, questionIdx:nextIdx, revealed:[], questionCount:s.questionCount+1 };
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'scores') {
        renderScoreboard(root, players, s.scores, {
          onReplay: isHost ? () => { const ns = GameEngines.famille.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

      if (!isHost) {
        _sub = DB.subscribeRoom(Session.room.id, (room) => {
          if (!room.game_state) return;
          Logger.debug('famille', 'État reçu', room.game_state.phase);
          try { render(room.game_state); }
          catch (e) { Logger.error('famille', 'render() a échoué sur update realtime :', e.message, e.stack); showFatalError(e.message); }
        });
      }
    };

    render(state);
  }
};
