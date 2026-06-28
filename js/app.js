// ══════════════════════════════════════
// app.js — Router + shared utils
// ══════════════════════════════════════

// ── Screen router ──────────────────────────────────────────
const SCREENS = ['home','name','lobby','game'];

function showScreen(id) {
  SCREENS.forEach(s => {
    document.getElementById(`screen-${s}`)
      .classList.toggle('active', s === id);
  });
}

// ── Toast ──────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Shuffle ────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Scoreboard renderer ────────────────────────────────────
function renderScoreboard(container, players, scores, { onReplay, onHome }) {
  const sorted = players
    .map(p => ({ ...p, score: scores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score);
  const max = sorted[0]?.score || 1;

  const ranks = ['r1','r2','r3'];
  const labels = ['🥇','🥈','🥉'];

  container.innerHTML = `
    <div class="game-header">
      <div class="game-title">🏆 Scores</div>
    </div>
    <div class="game-body">
      <div class="score-list">
        ${sorted.map((p, i) => `
          <div class="score-row pop" style="animation-delay:${i * .1}s">
            <div class="score-rank ${ranks[i]||''}">${labels[i]||i+1}</div>
            <div class="score-info">
              <div class="score-name">${p.avatar} ${p.name}</div>
              <div class="score-bar-wrap">
                <div class="score-bar" style="width:${Math.max(5, p.score/max*100)}%"></div>
              </div>
            </div>
            <div class="score-pts">${p.score}</div>
          </div>
        `).join('')}
      </div>
      ${onReplay ? `<button class="btn-primary" onclick="(${onReplay})()">🔄 REJOUER</button>` : ''}
      <button class="btn-secondary" onclick="(${onHome})()">🏠 Retour au lobby</button>
    </div>
  `;
}

// ── Back buttons ────────────────────────────────────────────
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

// ── Game engines registry ───────────────────────────────────
// Each game must register itself here
const GameEngines = {};

// ── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initLobby();
  showScreen('home');
});
