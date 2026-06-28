// ══════════════════════════════════════
// games/famille.js
// ══════════════════════════════════════
// La banque de 200 questions catégorisées vit en base (GameContent.
// familleQuestions / GameContent.familleCategories, chargées au boot —
// cf. app.js et supabase_seed.sql). FAMILLE_CATEGORIES servira plus tard
// à laisser les joueurs choisir leurs thèmes avant de lancer la partie.

const FAMILLE_TIMER_SECONDS = 60;
const FAMILLE_WIN_SCORE = 100;

// Calcule qui mène et qui répond pour la manche `idx`, à partir d'un ordre
// fixe (`order`). En décalant l'answerer d'un cran par rapport au leader
// sur le même cycle, on garantit que :
//  - meneur ≠ répondant à chaque manche
//  - après un cycle complet (questionCount de 0 à n-1), CHAQUE joueur a
//    été meneur exactement une fois (et répondant exactement une fois).
function _familleRoundRoles(order, idx) {
  const n = order.length;
  return {
    leaderId: order[idx % n],
    answererId: order[(idx + 1) % n],
  };
}

// Effet visuel + vibration quand le chrono arrive à zéro — joué une seule
// fois localement par chaque appareil (synchronisé puisque tous calculent
// le même compte à rebours à partir du même roundStartedAt partagé).
function _familleTimeUpEffect(root) {
  root.classList.add('famille-timeup-flash');
  setTimeout(() => root.classList.remove('famille-timeup-flash'), 900);
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
}

GameEngines['famille'] = {

  initState(players) {
    const order = shuffle(players.map(p => p.id));
    const qIdx = Math.floor(Math.random() * GameContent.familleQuestions.length);
    const scores = Object.fromEntries(players.map(p => [p.id, 0]));
    const { leaderId, answererId } = _familleRoundRoles(order, 0);
    return {
      phase: 'play',    // play | scores
      questionIdx: qIdx,
      revealed: [],     // indices of revealed answers
      questionCount: 0,
      // Une manche par joueur : tout le monde est meneur exactement une
      // fois sur la durée de la partie (sauf victoire anticipée à 100 pts).
      totalRounds: players.length,
      scores,
      order,
      leaderId,
      answererId,
      winnerId: null,
      timerRunning: false,   // le chrono ne démarre QUE quand le meneur le lance
      roundStartedAt: null,  // pour calculer le compte à rebours côté client
      timerDuration: FAMILLE_TIMER_SECONDS,
    };
  },

  // mount() retourne sa fonction render : lobby.js gère UN SEUL abonnement
  // Realtime par partie et la rappelle à chaque mise à jour reçue (voir
  // cameleon.js pour le détail du bug que ça évite).
  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('famille', 'mount', { isHost, players: players.length });

    // Timer purement local à l'affichage : on ne pousse pas une écriture
    // en base chaque seconde (ça spammerait Realtime pour rien), on se
    // contente de calculer le temps restant à partir de `roundStartedAt`,
    // identique sur tous les appareils. Un seul intervalle vivant à la
    // fois : on le coupe au début de chaque render() pour ne pas en
    // empiler un par mise à jour reçue.
    let timerHandle = null;
    const stopTimer = () => { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } };

    const render = (s) => {
      stopTimer();
      root.innerHTML = '';
      const g = { g1:'#ff9500', g2:'#ff3d6b' };

      if (s.phase === 'play') {
        // Tolère un state persisté par une version antérieure du jeu
        // (avant l'ajout de la rotation meneur/répondant et du timer).
        const fallbackOrder = players.map(p => p.id);
        const fallbackRoles = _familleRoundRoles(fallbackOrder, s.questionCount || 0);
        s = {
          order: fallbackOrder,
          totalRounds: players.length,
          winnerId: null,
          timerRunning: false,
          roundStartedAt: null,
          timerDuration: FAMILLE_TIMER_SECONDS,
          ...fallbackRoles,
          ...s,
        };

        const isLeader = me.id === s.leaderId;
        const leader = players.find(p => p.id === s.leaderId);
        const answerer = players.find(p => p.id === s.answererId) || players[0];
        const amAnswerer = me.id === answerer.id;
        const q = GameContent.familleQuestions[s.questionIdx];

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🏆 Une Famille en Or</div></div>
          <div class="game-body slide-up">
            <div class="leader-bar" style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 14px;font-size:13px">
              <div>🎙️ Meneur : <strong>${leader?.avatar} ${leader?.name}${isLeader ? ' (toi)' : ''}</strong></div>
              <div style="font-size:11px;color:var(--muted)">Manche ${(s.questionCount||0)+1}/${s.totalRounds}</div>
            </div>

            <div class="turn-banner" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
              <div>
                <div class="turn-banner-label">CETTE QUESTION EST POUR</div>
                <div class="turn-banner-name">${answerer.avatar} ${answerer.name}${amAnswerer ? ' (toi)' : ''}</div>
              </div>
              ${s.timerRunning
                ? `<div id="famille-timer" style="font-family:'Space Mono',monospace;font-size:22px;font-weight:700;color:var(--accent4)">--:--</div>`
                : isLeader
                  ? `<button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2};width:auto;padding:10px 16px;font-size:14px" onclick="familleStartTimer()">▶️ Démarrer (${s.timerDuration}s)</button>`
                  : `<div style="font-size:11px;color:var(--muted);text-align:right">⏱️ En attente<br>du meneur</div>`}
            </div>
            ${!amAnswerer && !isLeader ? `<div style="font-size:12px;color:var(--muted);text-align:center">Vous observez cette manche — les points iront à ${answerer.name} si la réponse est validée. Premier à ${FAMILLE_WIN_SCORE} pts gagne !</div>` : ''}

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
              <div style="font-size:12px;color:var(--muted);text-align:center">${answerer.name} propose une réponse à voix haute → si elle correspond, appuie sur la ligne pour l'accepter (les points lui sont attribués). Sinon, ne fais rien. Premier à ${FAMILLE_WIN_SCORE} pts gagne !</div>
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

        // ── Timer (affichage local uniquement) ── ne tourne que si le
        // meneur l'a démarré (s.timerRunning), jamais automatiquement.
        if (s.timerRunning) {
          const timerEl = document.getElementById('famille-timer');
          let timeUpTriggered = false;
          const tick = () => {
            const elapsed = Math.floor((Date.now() - s.roundStartedAt) / 1000);
            const remaining = Math.max(0, s.timerDuration - elapsed);
            const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
            const ss = String(remaining % 60).padStart(2, '0');
            if (timerEl) {
              timerEl.textContent = `${mm}:${ss}`;
              timerEl.style.color = remaining === 0 ? '#ff3d6b' : (remaining <= 10 ? '#ff9500' : 'var(--accent4)');
            }
            if (remaining === 0) {
              stopTimer();
              if (!timeUpTriggered) { timeUpTriggered = true; _familleTimeUpEffect(root); }
            }
          };
          tick();
          timerHandle = setInterval(tick, 1000);
        }

        // Le meneur déclenche lui-même le départ du chrono pour cette
        // manche — il ne se lance plus automatiquement à l'affichage.
        if (isLeader && !s.timerRunning) {
          window.familleStartTimer = () => {
            Logger.info('famille', 'Chrono démarré par le meneur');
            const ns = { ...s, timerRunning: true, roundStartedAt: Date.now() };
            onStateChange(ns); render(ns);
          };
        }

        // Vérifie la victoire immédiate à 100 pts et bascule vers les
        // scores si c'est le cas, sinon poursuit vers la manche suivante
        // avec un meneur/répondant qui tournent automatiquement.
        const _checkWinOrContinue = (ns) => {
          if ((ns.scores[s.answererId] || 0) >= FAMILLE_WIN_SCORE) {
            Logger.info('famille', s.answererId, 'a atteint', FAMILLE_WIN_SCORE, 'points — victoire');
            ns.phase = 'scores';
            ns.winnerId = s.answererId;
          }
          onStateChange(ns); render(ns);
        };

        if (isLeader) {
          window.familleReveal = (idx) => {
            if (s.revealed.includes(idx)) return;
            const q = GameContent.familleQuestions[s.questionIdx];
            const pts = q.answers[idx].pts;
            const ns = { ...s, revealed:[...s.revealed, idx], scores:{...s.scores} };
            // Les points vont en entier au joueur à qui la question est
            // destinée — avant, ils étaient partagés entre tout le monde.
            ns.scores[s.answererId] = (ns.scores[s.answererId]||0) + pts;
            _checkWinOrContinue(ns);
          };
          window.familleRevealAll = () => {
            const q = GameContent.familleQuestions[s.questionIdx];
            let ns = { ...s, scores:{...s.scores} };
            q.answers.forEach((a, i) => {
              if (!s.revealed.includes(i)) {
                ns.scores[s.answererId] = (ns.scores[s.answererId]||0) + a.pts;
              }
            });
            ns.revealed = q.answers.map((_,i)=>i);
            _checkWinOrContinue(ns);
          };
          window.familleNext = () => {
            const nextQuestionCount = s.questionCount + 1;
            if (nextQuestionCount >= s.totalRounds) {
              // Tout le monde a mené une fois sans qu'aucun atteigne 100 pts
              // — la partie se termine, le classement décide.
              const ns = { ...s, phase:'scores' };
              onStateChange(ns); render(ns); return;
            }
            let nextIdx;
            do { nextIdx = Math.floor(Math.random()*GameContent.familleQuestions.length); }
            while (nextIdx === s.questionIdx && GameContent.familleQuestions.length > 1);
            const { leaderId, answererId } = _familleRoundRoles(s.order, nextQuestionCount);
            const ns = {
              ...s,
              questionIdx: nextIdx,
              revealed: [],
              questionCount: nextQuestionCount,
              leaderId,
              answererId,
              timerRunning: false,
              roundStartedAt: null,
            };
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'scores') {
        const winner = s.winnerId ? players.find(p => p.id === s.winnerId) : null;
        if (winner) {
          const banner = document.createElement('div');
          banner.style.cssText = 'text-align:center;font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1px;color:var(--accent4);padding:16px 0 4px';
          banner.textContent = `🏆 ${winner.avatar} ${winner.name} a atteint ${FAMILLE_WIN_SCORE} points !`;
          root.appendChild(banner);
        }
        const scoreContainer = document.createElement('div');
        root.appendChild(scoreContainer);
        renderScoreboard(scoreContainer, players, s.scores, {
          onReplay: isHost ? () => { const ns = GameEngines.famille.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
      }

    };

    render(state);
    return render;
  }
};
