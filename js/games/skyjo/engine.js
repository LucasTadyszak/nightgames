// ══════════════════════════════════════════════════════════════════════
// games/skyjo/engine.js — Moteur de jeu "Cascade"
// ══════════════════════════════════════════════════════════════════════
//
// "Cascade" reprend les MÉCANIQUES d'un jeu de cartes de type "réduis ton
// score" (grille 3×4, pioche/défausse, échange, colonnes identiques
// supprimées). Nom, visuels et identité sont 100 % originaux.
//
// Ce fichier ne contient AUCUNE référence au DOM : c'est de la logique pure.
// Il est donc directement testable en Node (voir engine.test.js) et
// réutilisable pour un futur mode en ligne (l'état est un simple objet JSON
// sérialisable). Toute l'aléa passe par une fonction `rng` injectable, ce
// qui rend les parties reproductibles dans les tests.
//
// L'état (`GameState`) est volontairement plat et sérialisable :
//   {
//     round, phase, currentPlayer, startingPlayer,
//     players: [{ id, name, isAI, aiLevel, grid, roundScore, totalScore }],
//     grid item: { value:int, faceUp:bool, removed:bool },
//     drawPile: [int...], discardPile: [int...],
//     drawnCard: int|null, drawnFrom: 'draw'|'discard'|null,
//     finalTurnBy: index|null, turnsRemaining: int|null,
//     lastEvents: [ ...événements de la dernière transition, pour l'UI ],
//     roundResult: {...}|null, winner: index|null,
//   }
//
// Phases :
//   'setup'     → chaque joueur doit révéler 2 cartes (flipInitial)
//   'turn'      → le joueur courant doit choisir une source (draw/discard)
//   'drawn'     → une carte est en main : replace, ou (si pioche) discard→flip
//   'flip'      → après avoir défaussé la pioche : révéler une carte cachée
//   'roundEnd'  → manche terminée, scores calculés (voir roundResult)
//   'gameEnd'   → un joueur a atteint END_SCORE : winner défini
// ══════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // ── Constantes de règles ────────────────────────────────────────────
  const ROWS = 3;
  const COLS = 4;
  const GRID_SIZE = ROWS * COLS;          // 12 cartes par joueur
  const END_SCORE = 100;                  // fin de partie dès qu'un total ≥ 100
  const INITIAL_FLIPS = 2;                // cartes révélées au départ

  // Composition officielle du paquet : 150 cartes.
  //   -2 ×5, -1 ×10, 0 ×15, puis 1..12 ×10 chacune.
  function createDeck() {
    const deck = [];
    const push = (val, count) => { for (let i = 0; i < count; i++) deck.push(val); };
    push(-2, 5);
    push(-1, 10);
    push(0, 15);
    for (let v = 1; v <= 12; v++) push(v, 10);
    return deck; // 5 + 10 + 15 + 120 = 150
  }

  // ── Utilitaires ─────────────────────────────────────────────────────

  // Mélange de Fisher-Yates avec RNG injectable (Math.random par défaut).
  function shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const colIndices = (c) => [c, c + COLS, c + 2 * COLS]; // indices d'une colonne

  // Cartes encore en jeu (non retirées par une colonne) d'une grille.
  const liveCards = (grid) => grid.filter((c) => !c.removed);

  // Une grille est "complète" quand plus aucune carte n'est cachée
  // (toutes révélées ou retirées) → déclenche le tour final.
  function isGridComplete(grid) {
    return grid.every((c) => c.removed || c.faceUp);
  }

  // Score d'une grille : somme des valeurs des cartes non retirées.
  // Pendant la manche on ne compte que les cartes révélées (les cachées
  // sont inconnues) ; en fin de manche toutes sont révélées.
  function gridScore(grid, onlyFaceUp = false) {
    return grid.reduce((sum, c) => {
      if (c.removed) return sum;
      if (onlyFaceUp && !c.faceUp) return sum;
      return sum + c.value;
    }, 0);
  }

  // ── Création d'une partie ───────────────────────────────────────────
  //
  // playerConfigs : [{ id?, name, isAI?, aiLevel? }]
  // opts.rng      : fonction aléatoire injectable (tests reproductibles)
  function newGame(playerConfigs, opts = {}) {
    if (!Array.isArray(playerConfigs) || playerConfigs.length < 2) {
      throw new Error('Cascade : il faut au moins 2 joueurs.');
    }
    const rng = opts.rng || Math.random;
    const players = playerConfigs.map((p, i) => ({
      id: p.id != null ? p.id : `p${i}`,
      name: p.name || `Joueur ${i + 1}`,
      isAI: !!p.isAI,
      aiLevel: p.aiLevel || 'medium',
      grid: [],
      roundScore: 0,
      totalScore: 0,
    }));

    const state = {
      round: 1,
      phase: 'setup',
      currentPlayer: 0,
      startingPlayer: 0,
      players,
      drawPile: [],
      discardPile: [],
      drawnCard: null,
      drawnFrom: null,
      finalTurnBy: null,
      turnsRemaining: null,
      lastEvents: [],
      roundResult: null,
      winner: null,
      _rng: null, // non sérialisé volontairement ; ré-injecté par dealRound
    };
    dealRound(state, rng);
    return state;
  }

  // Distribue une nouvelle manche : reconstruit le paquet, remplit chaque
  // grille de 12 cartes face cachée, retourne une carte en défausse.
  function dealRound(state, rng = Math.random) {
    const deck = shuffle(createDeck(), rng);
    let d = 0;
    state.players.forEach((p) => {
      p.grid = [];
      p.roundScore = 0;
      for (let i = 0; i < GRID_SIZE; i++) {
        p.grid.push({ value: deck[d++], faceUp: false, removed: false });
      }
    });
    state.discardPile = [deck[d++]];
    state.drawPile = deck.slice(d);
    state.phase = 'setup';
    state.currentPlayer = 0;
    state.drawnCard = null;
    state.drawnFrom = null;
    state.finalTurnBy = null;
    state.turnsRemaining = null;
    state.roundResult = null;
    state.lastEvents = [{ type: 'deal', round: state.round }];
  }

  // ── Phase setup : révéler 2 cartes par joueur ───────────────────────
  //
  // Chaque joueur retourne 2 cartes. On avance de joueur en joueur.
  // Quand tout le monde a révélé 2 cartes, on détermine qui commence
  // (somme des 2 cartes visibles la plus élevée) et on passe en 'turn'.
  function flipInitial(state, playerIndex, cardIndex) {
    if (state.phase !== 'setup') throw new Error('flipInitial hors phase setup');
    const grid = state.players[playerIndex].grid;
    const flipped = grid.filter((c) => c.faceUp).length;
    if (flipped >= INITIAL_FLIPS) throw new Error('Ce joueur a déjà révélé 2 cartes');
    if (grid[cardIndex].faceUp) throw new Error('Carte déjà révélée');
    grid[cardIndex].faceUp = true;
    state.lastEvents = [{ type: 'flipInitial', player: playerIndex, index: cardIndex }];

    // Tous les joueurs ont-ils fini leur setup ?
    const allDone = state.players.every(
      (p) => p.grid.filter((c) => c.faceUp).length >= INITIAL_FLIPS
    );
    if (allDone) {
      let best = -Infinity, bestIdx = 0;
      state.players.forEach((p, i) => {
        const s = gridScore(p.grid, true);
        if (s > best) { best = s; bestIdx = i; }
      });
      state.startingPlayer = bestIdx;
      state.currentPlayer = bestIdx;
      state.phase = 'turn';
      state.lastEvents.push({ type: 'startPlayer', player: bestIdx });
    }
    return state;
  }

  // Nombre de cartes qu'il reste à révéler au joueur en phase setup.
  function initialFlipsLeft(state, playerIndex) {
    const flipped = state.players[playerIndex].grid.filter((c) => c.faceUp).length;
    return Math.max(0, INITIAL_FLIPS - flipped);
  }

  // ── Pioche / défausse ───────────────────────────────────────────────

  // Si la pioche est vide, on remélange la défausse (en gardant sa carte
  // du dessus) pour reconstituer une pioche.
  function ensureDrawPile(state, rng = Math.random) {
    if (state.drawPile.length > 0) return;
    if (state.discardPile.length <= 1) return; // rien à remélanger
    const top = state.discardPile.pop();
    state.drawPile = shuffle(state.discardPile, rng);
    state.discardPile = [top];
    state.lastEvents.push({ type: 'reshuffle' });
  }

  function drawFromPile(state, opts = {}) {
    if (state.phase !== 'turn') throw new Error('drawFromPile hors phase turn');
    ensureDrawPile(state, opts.rng || Math.random);
    state.drawnCard = state.drawPile.shift();
    state.drawnFrom = 'draw';
    state.phase = 'drawn';
    state.lastEvents = [{ type: 'draw', from: 'draw', value: state.drawnCard }];
    return state;
  }

  function takeFromDiscard(state) {
    if (state.phase !== 'turn') throw new Error('takeFromDiscard hors phase turn');
    if (state.discardPile.length === 0) throw new Error('Défausse vide');
    state.drawnCard = state.discardPile.pop();
    state.drawnFrom = 'discard';
    state.phase = 'drawn';
    state.lastEvents = [{ type: 'draw', from: 'discard', value: state.drawnCard }];
    return state;
  }

  // Remplace la carte `cardIndex` par la carte en main. L'ancienne carte
  // part en défausse (et devient visible), la nouvelle est posée face
  // visible. Puis on résout les colonnes et on termine le tour.
  function replaceCard(state, cardIndex) {
    if (state.phase !== 'drawn') throw new Error('replaceCard hors phase drawn');
    const p = state.players[state.currentPlayer];
    const cell = p.grid[cardIndex];
    if (cell.removed) throw new Error('Impossible : carte déjà retirée');

    const old = cell.value;
    state.discardPile.push(old);
    cell.value = state.drawnCard;
    cell.faceUp = true;
    state.lastEvents = [{
      type: 'replace', player: state.currentPlayer, index: cardIndex,
      placed: state.drawnCard, discarded: old, from: state.drawnFrom,
    }];
    state.drawnCard = null;
    state.drawnFrom = null;
    resolveColumns(state, state.currentPlayer);
    endTurn(state);
    return state;
  }

  // Défausse la carte piochée (uniquement si elle vient de la pioche),
  // puis le joueur DOIT révéler une carte cachée (phase 'flip').
  function discardDrawn(state) {
    if (state.phase !== 'drawn') throw new Error('discardDrawn hors phase drawn');
    if (state.drawnFrom !== 'draw') {
      throw new Error('On ne peut défausser que la carte piochée, pas celle prise en défausse');
    }
    state.discardPile.push(state.drawnCard);
    state.lastEvents = [{ type: 'discardDrawn', value: state.drawnCard }];
    state.drawnCard = null;
    state.drawnFrom = null;
    state.phase = 'flip';
    return state;
  }

  // Révèle une carte cachée (obligatoire après avoir défaussé la pioche).
  function flipCard(state, cardIndex) {
    if (state.phase !== 'flip') throw new Error('flipCard hors phase flip');
    const p = state.players[state.currentPlayer];
    const cell = p.grid[cardIndex];
    if (cell.removed) throw new Error('Carte déjà retirée');
    if (cell.faceUp) throw new Error('Carte déjà révélée');
    cell.faceUp = true;
    state.lastEvents = [{ type: 'flip', player: state.currentPlayer, index: cardIndex, value: cell.value }];
    resolveColumns(state, state.currentPlayer);
    endTurn(state);
    return state;
  }

  // ── Résolution des colonnes ─────────────────────────────────────────
  // Une colonne dont les 3 cartes présentes sont toutes visibles et de
  // même valeur est retirée (les 3 cartes vont en défausse).
  function resolveColumns(state, playerIndex) {
    const grid = state.players[playerIndex].grid;
    for (let c = 0; c < COLS; c++) {
      const idx = colIndices(c);
      const cells = idx.map((i) => grid[i]);
      if (cells.some((cell) => cell.removed)) continue; // colonne déjà cassée
      if (cells.every((cell) => cell.faceUp) &&
          cells[0].value === cells[1].value &&
          cells[1].value === cells[2].value) {
        cells.forEach((cell) => {
          state.discardPile.push(cell.value);
          cell.removed = true;
        });
        state.lastEvents.push({
          type: 'columnCleared', player: playerIndex, col: c, value: cells[0].value,
        });
      }
    }
  }

  // ── Fin de tour / de manche ─────────────────────────────────────────
  function endTurn(state) {
    const cur = state.currentPlayer;

    // Le joueur courant vient-il de compléter sa grille ? Si oui et que le
    // tour final n'est pas encore lancé, on l'arme : chaque autre joueur
    // joue encore une fois.
    if (state.finalTurnBy === null && isGridComplete(state.players[cur].grid)) {
      state.finalTurnBy = cur;
      state.turnsRemaining = state.players.length - 1;
      state.lastEvents.push({ type: 'finalTurn', player: cur });
    } else if (state.finalTurnBy !== null) {
      state.turnsRemaining -= 1;
    }

    if (state.finalTurnBy !== null && state.turnsRemaining <= 0) {
      endRound(state);
      return;
    }

    state.currentPlayer = (cur + 1) % state.players.length;
    state.phase = 'turn';
  }

  // Calcule les scores de la manche, applique la règle du doublement et
  // met à jour les totaux. Passe en 'gameEnd' si un total ≥ END_SCORE.
  function endRound(state) {
    // Révéler toutes les cartes restantes (elles comptent).
    state.players.forEach((p) => p.grid.forEach((c) => { if (!c.removed) c.faceUp = true; }));
    // Une révélation finale peut compléter une colonne identique.
    state.players.forEach((_, i) => resolveColumns(state, i));

    const raw = state.players.map((p) => gridScore(p.grid));
    const closer = state.finalTurnBy;

    // Règle du doublement : si celui qui a déclaré n'a pas le score
    // strictement le plus bas de la table, son score est doublé.
    const minOther = Math.min(...raw.filter((_, i) => i !== closer));
    const doubled = raw[closer] >= minOther; // pas strictement le plus bas
    const finalScores = raw.slice();
    if (doubled && raw[closer] > 0) finalScores[closer] = raw[closer] * 2;

    state.players.forEach((p, i) => {
      p.roundScore = finalScores[i];
      p.totalScore += finalScores[i];
    });

    state.roundResult = {
      round: state.round,
      closer,
      doubled: doubled && raw[closer] > 0,
      rawScores: raw,
      finalScores,
      totals: state.players.map((p) => p.totalScore),
    };
    state.phase = 'roundEnd';
    state.lastEvents.push({ type: 'roundEnd', result: state.roundResult });

    // Fin de partie ?
    const maxTotal = Math.max(...state.players.map((p) => p.totalScore));
    if (maxTotal >= END_SCORE) {
      let best = Infinity, winner = 0;
      state.players.forEach((p, i) => { if (p.totalScore < best) { best = p.totalScore; winner = i; } });
      state.winner = winner;
      state.phase = 'gameEnd';
      state.lastEvents.push({ type: 'gameEnd', winner });
    }
  }

  // Démarre la manche suivante (après phase 'roundEnd').
  function startNextRound(state, opts = {}) {
    if (state.phase !== 'roundEnd') throw new Error('startNextRound hors phase roundEnd');
    state.round += 1;
    dealRound(state, opts.rng || Math.random);
    return state;
  }

  // ── Helpers de lecture (pour l'UI et l'IA) ──────────────────────────
  const topDiscard = (state) => state.discardPile[state.discardPile.length - 1];
  const currentPlayer = (state) => state.players[state.currentPlayer];

  // Liste des index de cartes cachées d'une grille (cibles de flip).
  function hiddenIndices(grid) {
    const out = [];
    grid.forEach((c, i) => { if (!c.removed && !c.faceUp) out.push(i); });
    return out;
  }
  // Liste des index de cartes encore en jeu (cibles de remplacement).
  function replaceableIndices(grid) {
    const out = [];
    grid.forEach((c, i) => { if (!c.removed) out.push(i); });
    return out;
  }

  const API = {
    // constantes
    ROWS, COLS, GRID_SIZE, END_SCORE, INITIAL_FLIPS,
    // création
    createDeck, shuffle, newGame, dealRound, startNextRound,
    // setup
    flipInitial, initialFlipsLeft,
    // tour
    drawFromPile, takeFromDiscard, replaceCard, discardDrawn, flipCard,
    // règles internes exposées pour tests
    resolveColumns, endRound, gridScore, isGridComplete,
    // lecture
    topDiscard, currentPlayer, hiddenIndices, replaceableIndices,
    colIndices, liveCards, clone,
  };

  // Export universel : global navigateur (window.SkyjoEngine) + CommonJS.
  root.SkyjoEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
