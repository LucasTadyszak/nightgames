// ══════════════════════════════════════════════════════════════════════
// games/skyjo/engine.test.js — Tests unitaires du moteur "Cascade"
// ══════════════════════════════════════════════════════════════════════
//
// Exécution :  node js/games/skyjo/engine.test.js
// Aucun framework externe : mini-runner intégré. Sortie lisible + code de
// sortie non nul si un test échoue (utilisable en CI).
// ══════════════════════════════════════════════════════════════════════

const E = require('./engine.js');

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(`  ✅ ${name}`); }
  catch (e) { failed++; results.push(`  ❌ ${name}\n       ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion échouée'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'égalité'} : attendu ${b}, reçu ${a}`); }

// RNG déterministe (LCG) pour des parties reproductibles.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Aide : joue les 2 révélations initiales de tous les joueurs.
function doSetup(state) {
  state.players.forEach((p, pi) => {
    while (E.initialFlipsLeft(state, pi) > 0) {
      const hidden = E.hiddenIndices(p.grid);
      E.flipInitial(state, pi, hidden[0]);
    }
  });
}

// ── Composition du paquet ────────────────────────────────────────────
test('Le paquet contient 150 cartes', () => {
  eq(E.createDeck().length, 150, 'taille du paquet');
});
test('Répartition exacte des valeurs du paquet', () => {
  const deck = E.createDeck();
  const count = (v) => deck.filter((x) => x === v).length;
  eq(count(-2), 5, '-2');
  eq(count(-1), 10, '-1');
  eq(count(0), 15, '0');
  for (let v = 1; v <= 12; v++) eq(count(v), 10, `valeur ${v}`);
  // Somme attendue : -2·5 + -1·10 + 0·15 + Σ(1..12)·10 = -20 + 780 = 760.
  eq(deck.reduce((a, b) => a + b, 0), 760, 'somme du paquet');
});

// ── Distribution ──────────────────────────────────────────────────────
test('newGame distribue 12 cartes cachées par joueur', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(1) });
  eq(s.players.length, 2, 'nb joueurs');
  s.players.forEach((p) => {
    eq(p.grid.length, 12, 'taille grille');
    eq(p.grid.filter((c) => c.faceUp).length, 0, 'cartes visibles au départ');
  });
  eq(s.discardPile.length, 1, 'une carte en défausse');
  eq(s.drawPile.length, 150 - 24 - 1, 'reste en pioche');
});

test('newGame refuse moins de 2 joueurs', () => {
  let threw = false;
  try { E.newGame([{ name: 'Solo' }]); } catch (e) { threw = true; }
  assert(threw, 'devrait lever une erreur');
});

// ── Phase setup ───────────────────────────────────────────────────────
test('Le setup révèle 2 cartes par joueur puis passe en phase turn', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], { rng: seededRng(7) });
  eq(s.phase, 'setup', 'phase initiale');
  doSetup(s);
  eq(s.phase, 'turn', 'phase après setup');
  s.players.forEach((p) => eq(p.grid.filter((c) => c.faceUp).length, 2, 'cartes révélées'));
});

test('Le joueur avec la plus haute somme visible commence', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(3) });
  // Force des valeurs connues.
  s.players[0].grid[0] = { value: 12, faceUp: false, removed: false };
  s.players[0].grid[1] = { value: 12, faceUp: false, removed: false };
  s.players[1].grid[0] = { value: 0, faceUp: false, removed: false };
  s.players[1].grid[1] = { value: 1, faceUp: false, removed: false };
  E.flipInitial(s, 0, 0); E.flipInitial(s, 0, 1);
  E.flipInitial(s, 1, 0); E.flipInitial(s, 1, 1);
  eq(s.currentPlayer, 0, 'joueur qui commence');
});

// ── Pioche / remplacement ────────────────────────────────────────────
test('drawFromPile met une carte en main et passe en phase drawn', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(5) });
  doSetup(s);
  const before = s.drawPile.length;
  E.drawFromPile(s);
  eq(s.phase, 'drawn', 'phase');
  assert(s.drawnCard !== null, 'carte en main');
  eq(s.drawPile.length, before - 1, 'pioche décrémentée');
});

test('replaceCard défausse l’ancienne carte et révèle la nouvelle', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(9) });
  doSetup(s);
  const cur = s.currentPlayer;
  E.drawFromPile(s);
  const drawn = s.drawnCard;
  const target = E.hiddenIndices(s.players[cur].grid)[0];
  const old = s.players[cur].grid[target].value;
  const discBefore = s.discardPile.length;
  E.replaceCard(s, target);
  eq(s.players[cur].grid[target].value, drawn, 'nouvelle valeur posée');
  assert(s.players[cur].grid[target].faceUp, 'carte révélée');
  eq(s.discardPile[s.discardPile.length - 1], old, 'ancienne carte en défausse');
  eq(s.discardPile.length, discBefore + 1, 'défausse +1');
});

test('discardDrawn interdit après une prise en défausse', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(11) });
  doSetup(s);
  E.takeFromDiscard(s);
  let threw = false;
  try { E.discardDrawn(s); } catch (e) { threw = true; }
  assert(threw, 'doit lever une erreur');
});

test('discardDrawn puis flipCard révèle une carte cachée', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(13) });
  doSetup(s);
  const cur = s.currentPlayer;
  E.drawFromPile(s);
  E.discardDrawn(s);
  eq(s.phase, 'flip', 'phase flip');
  const idx = E.hiddenIndices(s.players[cur].grid)[0];
  E.flipCard(s, idx);
  assert(s.players[cur].grid[idx].faceUp, 'carte révélée');
  assert(s.currentPlayer !== cur || s.phase !== 'flip', 'le tour a avancé');
});

// ── Colonnes ──────────────────────────────────────────────────────────
test('Une colonne de 3 cartes identiques est retirée', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(21) });
  const g = s.players[0].grid;
  // Colonne 0 = index 0,4,8. On force trois 5 visibles.
  [0, 4, 8].forEach((i) => { g[i] = { value: 5, faceUp: true, removed: false }; });
  const discBefore = s.discardPile.length;
  E.resolveColumns(s, 0);
  [0, 4, 8].forEach((i) => assert(g[i].removed, `index ${i} retiré`));
  eq(s.discardPile.length, discBefore + 3, '3 cartes en défausse');
});

test('Une colonne non totalement révélée n’est pas retirée', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(22) });
  const g = s.players[0].grid;
  g[0] = { value: 7, faceUp: true, removed: false };
  g[4] = { value: 7, faceUp: true, removed: false };
  g[8] = { value: 7, faceUp: false, removed: false }; // cachée
  E.resolveColumns(s, 0);
  assert(!g[0].removed, 'ne doit pas être retirée');
});

// ── Scoring & fin de manche ──────────────────────────────────────────
test('gridScore ignore les cartes retirées', () => {
  const grid = [
    { value: 5, faceUp: true, removed: false },
    { value: 8, faceUp: true, removed: true },
    { value: -2, faceUp: true, removed: false },
  ];
  eq(E.gridScore(grid), 3, 'score net');
});

test('Le déclencheur voit son score doublé s’il n’est pas le plus bas', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(31) });
  // Joueur 0 déclenche avec 20, joueur 1 a 10 → 0 doit être doublé.
  s.players[0].grid = Array.from({ length: 12 }, (_, i) =>
    ({ value: i === 0 ? 20 : 0, faceUp: true, removed: false }));
  s.players[1].grid = Array.from({ length: 12 }, (_, i) =>
    ({ value: i === 0 ? 10 : 0, faceUp: true, removed: false }));
  s.finalTurnBy = 0;
  E.endRound(s);
  eq(s.roundResult.finalScores[0], 40, 'score doublé du déclencheur');
  eq(s.roundResult.finalScores[1], 10, 'score normal de l’autre');
  assert(s.roundResult.doubled, 'flag doublé');
});

test('Le déclencheur n’est pas doublé s’il a le score strictement le plus bas', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(32) });
  s.players[0].grid = Array.from({ length: 12 }, (_, i) =>
    ({ value: i === 0 ? 5 : 0, faceUp: true, removed: false }));
  s.players[1].grid = Array.from({ length: 12 }, (_, i) =>
    ({ value: i === 0 ? 30 : 0, faceUp: true, removed: false }));
  s.finalTurnBy = 0;
  E.endRound(s);
  eq(s.roundResult.finalScores[0], 5, 'pas de doublement');
  assert(!s.roundResult.doubled, 'flag non doublé');
});

test('La partie se termine quand un total atteint 100', () => {
  const s = E.newGame([{ name: 'A' }, { name: 'B' }], { rng: seededRng(41) });
  s.players[0].totalScore = 95;
  s.players[1].totalScore = 40;
  s.players[0].grid = Array.from({ length: 12 }, (_, i) =>
    ({ value: i === 0 ? 10 : 0, faceUp: true, removed: false }));
  s.players[1].grid = Array.from({ length: 12 }, (_, i) =>
    ({ value: i === 0 ? 5 : 0, faceUp: true, removed: false }));
  s.finalTurnBy = 1; // joueur 1 déclenche
  E.endRound(s);
  eq(s.phase, 'gameEnd', 'phase fin de partie');
  eq(s.winner, 1, 'gagnant = plus bas total');
});

// ── Intégrité : simulation d’une partie complète pilotée par l’IA ─────
test('Simulation IA complète : partie qui se termine sans erreur', () => {
  const AI = require('./ai.js');
  const s = E.newGame(
    [{ name: 'A', isAI: true, aiLevel: 'hard' },
     { name: 'B', isAI: true, aiLevel: 'medium' },
     { name: 'C', isAI: true, aiLevel: 'easy' }],
    { rng: seededRng(1234) }
  );
  let guard = 0;
  const rng = seededRng(999);
  while (s.phase !== 'gameEnd' && guard++ < 5000) {
    if (s.phase === 'setup') {
      s.players.forEach((p, pi) => {
        while (E.initialFlipsLeft(s, pi) > 0) {
          E.flipInitial(s, pi, AI.chooseInitialFlip(s, pi));
        }
      });
    } else if (s.phase === 'turn') {
      const src = AI.chooseSource(s);
      if (src === 'discard') E.takeFromDiscard(s); else E.drawFromPile(s, { rng });
    } else if (s.phase === 'drawn') {
      const d = AI.afterDraw(s);
      if (d.action === 'replace') E.replaceCard(s, d.index); else E.discardDrawn(s);
    } else if (s.phase === 'flip') {
      E.flipCard(s, AI.chooseFlip(s));
    } else if (s.phase === 'roundEnd') {
      E.startNextRound(s, { rng });
    }
  }
  eq(s.phase, 'gameEnd', 'la partie doit se terminer');
  assert(guard < 5000, 'pas de boucle infinie');
  assert(s.winner !== null, 'un gagnant est désigné');
  // Tous les totaux sont cohérents (>= somme des manches, un ≥ 100).
  assert(Math.max(...s.players.map((p) => p.totalScore)) >= E.END_SCORE, 'un total ≥ 100');
});

// ── Rapport ───────────────────────────────────────────────────────────
console.log('\n🎴 Cascade — Tests du moteur\n');
console.log(results.join('\n'));
console.log(`\n${passed} réussi(s), ${failed} échec(s).\n`);
process.exit(failed ? 1 : 0);
