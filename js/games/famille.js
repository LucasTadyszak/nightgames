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
      // Le "meneur" est le joueur qui juge si une réponse dite à voix haute
      // correspond à une réponse du tableau (et la révèle), ou la refuse.
      // Par défaut c'est le host, mais ce n'est pas obligé de le rester —
      // si le host fait partie de l'équipe qui doit deviner, il doit
      // pouvoir passer le rôle de meneur à quelqu'un d'autre.
      leaderId: (players.find(p => p.is_host) || players[0]).id,
    };
  },

  // mount() retourne sa fonction render : lobby.js gère UN SEUL abonnement
  // Realtime par partie et la rappelle à chaque mise à jour reçue (voir
  // cameleon.js pour le détail du bug que ça évite).
  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('famille', 'mount', { isHost, players: players.length });

    const render = (s) => {
      root.innerHTML = '';
      const g = { g1:'#ff9500', g2:'#ff3d6b' };

      if (s.phase === 'play') {
        // state hérité d'une partie démarrée avant l'ajout du meneur.
        const leaderId = s.leaderId || (players.find(p => p.is_host) || players[0]).id;
        const isLeader = me.id === leaderId;
        const leader = players.find(p => p.id === leaderId);
        const q = FAMILLE_QUESTIONS[s.questionIdx];

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🏆 Une Famille en Or</div></div>
          <div class="game-body slide-up">
            <div class="leader-bar" style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 14px;font-size:13px">
              <div>🎙️ Meneur : <strong>${leader?.avatar} ${leader?.name}${isLeader ? ' (toi)' : ''}</strong></div>
              <button class="btn-secondary" id="famille-btn-pick-leader" style="width:auto;padding:8px 12px;font-size:12px">Changer</button>
            </div>
            <div id="famille-leader-picker"></div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(18px,5vw,26px);text-align:center;line-height:1.3;padding:20px;background:var(--surface);border-radius:var(--r-lg);border:1px solid var(--border)">
              ${q.q}
            </div>
            ${isLeader ? `<div style="font-size:11px;color:var(--accent3);text-align:center;letter-spacing:1px">📵 TOI SEUL VOIS LES RÉPONSES NON RÉVÉLÉES</div>` : ''}
            <div style="display:flex;flex-direction:column;gap:8px">
              ${q.answers.map((a, i) => {
                const revealed = s.revealed.includes(i);
                // Le meneur doit voir le texte caché pour pouvoir juger si
                // ce qui a été dit à voix haute correspond — avant, même
                // lui voyait "???" et ne pouvait pas savoir quoi révéler.
                const showText = revealed || isLeader;
                return `
                <div class="answer-row ${revealed?'revealed':''} ${isLeader && !revealed ? 'leader-peek' : ''}"
                  ${isLeader && !revealed ? `onclick="familleReveal(${i})"` : ''}>
                  <div class="answer-num">${i+1}</div>
                  <div class="answer-text">${showText ? a.t : '???'}</div>
                  <div class="answer-pts">${revealed ? `+${a.pts}` : (isLeader ? a.pts : '🔒')}</div>
                </div>
              `;
              }).join('')}
            </div>
            ${isLeader ? `
              <div class="btn-row">
                <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="familleRevealAll()">Tout révéler</button>
                <button class="btn-secondary" onclick="familleNext()">Question suivante →</button>
              </div>
              <div style="font-size:12px;color:var(--muted);text-align:center">Quelqu'un propose une réponse à voix haute → si elle correspond, appuie sur la ligne pour l'accepter et la révéler. Sinon, ne fais rien (refusée).</div>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>${leader?.name} mène cette manche et valide les réponses…</div>`}
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

        // N'importe quel joueur peut proposer de changer de meneur (utile
        // si le meneur actuel doit lui-même deviner, ou n'est pas dispo) —
        // on ne réserve pas ça au host, ce n'est pas la même autorité.
        document.getElementById('famille-btn-pick-leader').addEventListener('click', () => {
          const picker = document.getElementById('famille-leader-picker');
          picker.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">
              ${players.map(p => `
                <button class="btn-secondary" style="width:auto;padding:8px 12px;font-size:12px" onclick="familleSetLeader('${p.id}')">${p.avatar} ${p.name}</button>
              `).join('')}
            </div>
          `;
        });
        window.familleSetLeader = (pid) => {
          Logger.info('famille', 'Nouveau meneur désigné', pid);
          const ns = { ...s, leaderId: pid };
          onStateChange(ns); render(ns);
        };

        if (isLeader) {
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

    };

    render(state);
    return render;
  }
};
