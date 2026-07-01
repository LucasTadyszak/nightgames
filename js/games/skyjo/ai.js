// ══════════════════════════════════════════════════════════════════════
// games/skyjo/ai.js — Intelligence artificielle de "Cascade"
// ══════════════════════════════════════════════════════════════════════
//
// L'IA n'utilise QUE l'API publique de SkyjoEngine et lit l'état comme le
// ferait un humain (elle ne triche pas : elle ne connaît pas la valeur des
// cartes cachées). Elle expose des décisions atomiques calées sur les
// phases du moteur, pour que le contrôleur/UI puisse les jouer une par une
// et les animer :
//
//   chooseInitialFlip(state, playerIndex) → index à révéler
//   chooseSource(state)                   → 'draw' | 'discard'
//   afterDraw(state)                      → { action:'replace', index } | { action:'discard' }
//   chooseFlip(state)                     → index à révéler
//
// Trois niveaux, avec une VRAIE stratégie (jamais purement aléatoire) :
//   - easy   : seuils simples, un peu de bruit, ignore les colonnes.
//   - medium : gère les remplacements utiles + amorces de colonnes.
//   - hard   : évaluation fine (colonnes, valeur attendue, timing de fin).
// ══════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const E = root.SkyjoEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  if (!E) throw new Error('ai.js : SkyjoEngine introuvable (charger engine.js avant)');

  // Valeur moyenne d'une carte inconnue du paquet (~5.07). Sert de
  // référence pour décider si une carte visible "vaut mieux" que l'inconnu.
  const AVG_HIDDEN = 5;

  // ── Petits utilitaires de lecture de grille ─────────────────────────
  const colOf = (i) => i % E.COLS;

  // Valeurs visibles d'une colonne (hors carte optionnellement ignorée).
  function columnFaceValues(grid, col, ignoreIdx = -1) {
    return E.colIndices(col)
      .filter((i) => i !== ignoreIdx && !grid[i].removed && grid[i].faceUp)
      .map((i) => grid[i].value);
  }

  // Meilleure carte visible à remplacer par `incoming` : on cherche le plus
  // gros gain (valeurCourante - incoming) parmi les cartes révélées.
  function bestFaceUpReplacement(grid, incoming) {
    let best = null, bestGain = 0;
    grid.forEach((c, i) => {
      if (c.removed || !c.faceUp) return;
      const gain = c.value - incoming;
      if (gain > bestGain) { bestGain = gain; best = i; }
    });
    return best !== null ? { index: best, gain: bestGain } : null;
  }

  // Détecte une opportunité de colonne : placer `incoming` dans une colonne
  // où les autres cartes visibles valent déjà `incoming` (amorce un triplé,
  // idéalement supprimant une colonne coûteuse). Retourne un score de bonus.
  function columnOpportunity(grid, incoming) {
    let best = null, bestBonus = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i].removed) continue;
      const col = colOf(i);
      const others = columnFaceValues(grid, col, i);
      const matches = others.filter((v) => v === incoming).length;
      const otherCells = E.colIndices(col).filter((j) => j !== i && !grid[j].removed);
      if (matches === 0) continue;
      // matches == otherCells.length → poser ici COMPLÈTE la colonne
      // (les 3 identiques) → suppression : bonus = 3×valeur retirée.
      let bonus;
      if (matches === otherCells.length) bonus = incoming * 3 + 6; // suppression immédiate
      else bonus = incoming;                                       // amorce partielle
      // On préfère remplacer une carte déjà visible et coûteuse.
      const replacedGain = grid[i].faceUp ? grid[i].value - incoming : AVG_HIDDEN - incoming;
      const total = bonus + replacedGain;
      if (total > bestBonus) { bestBonus = total; best = i; }
    }
    return best !== null ? { index: best, bonus: bestBonus } : null;
  }

  // ── Conscience de la règle du DOUBLEMENT ────────────────────────────
  // Celui qui termine la manche voit son score DOUBLÉ s'il n'a pas le score
  // strictement le plus bas. Les IA moyenne/difficile évitent donc de
  // terminer la manche tant qu'elles ne sont pas sûres d'être en tête, et
  // terminent volontiers quand c'est le cas.

  const faceUpSum = (grid) =>
    grid.reduce((s, c) => (!c.removed && c.faceUp ? s + c.value : s), 0);

  // Estimation du score final d'un joueur : cartes visibles + espérance des
  // cartes encore cachées.
  function estimateScore(grid) {
    return faceUpSum(grid) + E.hiddenIndices(grid).length * AVG_HIDDEN;
  }

  // Terminer maintenant (avec `myProjected` comme score final estimé) est-il
  // "sûr" ? Il faut être nettement sous le meilleur adversaire estimé pour
  // ne pas risquer le doublement. La marge dépend du niveau.
  function finishingIsSafe(state, playerIndex, myProjected, level) {
    const margin = level === 'hard' ? 1 : 4; // difficile ose davantage
    let minOpp = Infinity;
    state.players.forEach((p, i) => {
      if (i === playerIndex) return;
      minOpp = Math.min(minOpp, estimateScore(p.grid));
    });
    return myProjected < minOpp - margin;
  }

  // ── Choix des révélations de départ ─────────────────────────────────
  // On révèle des cartes de coins/positions variées : peu importe la
  // valeur (inconnue), on évite juste de tout révéler sur une même colonne
  // pour garder des options de colonnes ouvertes. Simple et robuste.
  function chooseInitialFlip(state, playerIndex) {
    const grid = state.players[playerIndex].grid;
    const hidden = E.hiddenIndices(grid);
    // Préfère une colonne où rien n'est encore révélé (diversifie).
    const flippedCols = new Set(
      grid.map((c, i) => (c.faceUp ? colOf(i) : -1)).filter((c) => c >= 0)
    );
    const fresh = hidden.filter((i) => !flippedCols.has(colOf(i)));
    const pool = fresh.length ? fresh : hidden;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ── Choix de la source (pioche vs défausse) ─────────────────────────
  function chooseSource(state) {
    const p = E.currentPlayer(state);
    const level = p.aiLevel;
    const top = E.topDiscard(state);
    const grid = p.grid;

    if (level === 'easy') {
      // Prend la défausse seulement si elle est franchement basse.
      return top <= 2 ? 'discard' : 'draw';
    }

    // medium / hard : la défausse est intéressante si elle permet un bon
    // remplacement OU une opportunité de colonne.
    const repl = bestFaceUpReplacement(grid, top);
    const opp = columnOpportunity(grid, top);
    const threshold = level === 'hard' ? AVG_HIDDEN - 1 : AVG_HIDDEN;

    if (opp && opp.bonus > 3) return 'discard';           // colonne juteuse
    if (repl && repl.gain >= (level === 'hard' ? 3 : 4)) return 'discard';
    if (top <= threshold - 2) return 'discard';           // carte basse à saisir
    return 'draw';
  }

  // ── Décision après avoir pioché ─────────────────────────────────────
  // (uniquement quand la carte vient de la pioche : on peut la défausser.)
  function afterDraw(state) {
    const p = E.currentPlayer(state);
    const level = p.aiLevel;
    const grid = p.grid;
    const card = state.drawnCard;

    // Si la carte vient de la défausse, on est OBLIGÉ de remplacer.
    const mustReplace = state.drawnFrom === 'discard';

    const opp = columnOpportunity(grid, card);
    const repl = bestFaceUpReplacement(grid, card);

    // ── Gestion du DOUBLEMENT (moyen / difficile) ─────────────────────
    // Si une seule carte reste cachée, la révéler (ou poser dessus) TERMINE
    // la manche. On ne le fait que si on est sûr d'avoir le score le plus
    // bas (sinon notre score serait doublé). Sinon on temporise en posant
    // sur une carte VISIBLE (ce qui ne termine pas la manche).
    if (level !== 'easy') {
      const hidden = E.hiddenIndices(grid);
      if (hidden.length !== 1) {
        // Hors situation de fin : on remet à zéro le budget de temporisation.
        p._stall = 0;
      } else {
        const lastHidden = hidden[0];
        const projectedIfFinish = faceUpSum(grid) + card; // score si on pose sur la dernière cachée
        if (finishingIsSafe(state, state.currentPlayer, projectedIfFinish, level)) {
          // On est en tête : on termine la manche en verrouillant ce score.
          p._stall = 0;
          return { action: 'replace', index: lastHidden };
        }
        // Pas sûr d'être le plus bas → on TEMPORISE : poser sur une carte
        // VISIBLE (jamais la dernière cachée, jamais défausser) pour ne PAS
        // terminer la manche. On laisse ainsi le plus souvent un adversaire
        // devenir celui qui clôt (et subir le doublement à notre place).
        //
        // Budget de patience borné (cap) → garantit que la manche finit
        // toujours par se terminer (pas de blocage si tout le monde attend).
        const cap = level === 'hard' ? 4 : 2;
        if ((p._stall || 0) < cap) {
          p._stall = (p._stall || 0) + 1;
          // De préférence un remplacement qui baisse le score ; sinon la plus
          // grosse carte visible (dégât minimal), sans toucher la cachée.
          if (repl && repl.gain > 0) return { action: 'replace', index: repl.index };
          const faceUps = grid
            .map((c, i) => ({ c, i }))
            .filter((x) => !x.c.removed && x.c.faceUp);
          if (faceUps.length) {
            faceUps.sort((a, b) => b.c.value - a.c.value);
            return { action: 'replace', index: faceUps[0].i };
          }
        }
        // Budget épuisé (ou aucune carte visible) → on termine.
        p._stall = 0;
        return { action: 'replace', index: lastHidden };
      }
    }

    // 1) Opportunité de colonne franchement bonne → on la prend.
    if (opp && opp.bonus > 4) return { action: 'replace', index: opp.index };

    // 2) Remplacement d'une carte visible coûteuse.
    const replGainMin = level === 'easy' ? 3 : (level === 'hard' ? 2 : 3);
    if (repl && repl.gain >= replGainMin) return { action: 'replace', index: repl.index };

    // 3) Carte basse : vaut la peine de remplacer une carte CACHÉE
    //    (espérance ~5) même sans carte visible chère.
    const keepThreshold = level === 'hard' ? AVG_HIDDEN - 1 : (level === 'medium' ? AVG_HIDDEN : AVG_HIDDEN + 1);
    if (card <= keepThreshold) {
      const hidden = E.hiddenIndices(grid);
      if (hidden.length) return { action: 'replace', index: pickHiddenToReplace(grid, hidden) };
      // pas de cachée : remplace la plus grosse visible si gain positif
      if (repl && repl.gain > 0) return { action: 'replace', index: repl.index };
    }

    if (mustReplace) {
      // On doit poser : minimise la casse (meilleur gain, sinon sur cachée).
      if (repl && repl.gain > 0) return { action: 'replace', index: repl.index };
      const hidden = E.hiddenIndices(grid);
      if (hidden.length) return { action: 'replace', index: pickHiddenToReplace(grid, hidden) };
      // dernier recours : remplace n'importe quelle carte en jeu
      return { action: 'replace', index: E.replaceableIndices(grid)[0] };
    }

    return { action: 'discard' };
  }

  // Choisit quelle carte cachée sacrifier lors d'un remplacement : de
  // préférence une colonne qui n'a pas d'amorce, pour ne pas casser un
  // futur triplé. Sinon la première disponible.
  function pickHiddenToReplace(grid, hidden) {
    let best = hidden[0], bestScore = Infinity;
    hidden.forEach((i) => {
      const others = columnFaceValues(grid, colOf(i));
      // moins il y a de doublons visibles dans la colonne, mieux c'est à sacrifier
      const dupes = others.length - new Set(others).size;
      const score = dupes;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  // ── Choix de la carte à révéler (après avoir défaussé la pioche) ─────
  function chooseFlip(state) {
    const p = E.currentPlayer(state);
    const grid = p.grid;
    const hidden = E.hiddenIndices(grid);

    if (p.aiLevel === 'easy') {
      return hidden[Math.floor(Math.random() * hidden.length)];
    }

    // medium / hard : révéler en priorité une carte dans une colonne où
    // deux cartes visibles sont déjà identiques (chance de compléter un
    // triplé "gratuit"). Sinon révéler dans une colonne "neutre".
    let best = hidden[0], bestScore = -Infinity;
    hidden.forEach((i) => {
      const others = columnFaceValues(grid, colOf(i));
      const pair = others.length >= 2 && others[0] === others[1];
      const score = pair ? 2 : (others.length === 1 ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  root.SkyjoAI = { chooseInitialFlip, chooseSource, afterDraw, chooseFlip };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SkyjoAI;

})(typeof window !== 'undefined' ? window : globalThis);
