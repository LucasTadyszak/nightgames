// ══════════════════════════════════════════════════════════════════════
// games/skyjo/skyjo.js — Contrôleur UI + expérience de jeu "Cascade"
// ══════════════════════════════════════════════════════════════════════
//
// Ce fichier NE contient QUE de la présentation et de l'orchestration :
// toute la règle est dans engine.js, toute la décision IA dans ai.js.
// Séparation UI / logique métier ⇒ le moteur reste testable seul.
//
// Fonctionnalités :
//   • Solo contre des IA (facile / moyen / difficile)
//   • Multijoueur local (plusieurs joueurs sur le même appareil)
//   • Sauvegarde automatique + reprise de partie (localStorage)
//   • Statistiques de jeu, réglages (sons, musique*, animations, thème)
//   • Animations : distribution, retournement 3D, glissé, rebond, ombres,
//     effet de pression, particules de suppression de colonne, comptage
//     de score, transitions de tour, flash lumineux, vibration haptique.
//
// L'architecture (moteur ↔ IA ↔ contrôleur) est pensée pour brancher plus
// tard un mode EN LIGNE : l'état est sérialisable et les actions passent
// toutes par l'API du moteur ; il suffirait de synchroniser `S` via le
// réseau (ex. la couche Supabase déjà présente dans le projet).
// (*) La "musique" est ici un simple réglage : aucun asset audio n'est
//     embarqué, on ne génère que des effets sonores légers en WebAudio.
// ══════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const E = root.SkyjoEngine;
  const AI = root.SkyjoAI;
  if (!E || !AI) { console.error('Cascade : engine.js / ai.js manquants'); return; }

  const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🦄', '🐯', '🐻', '🐙', '🦖', '🦋'];
  const AI_NAMES = ['Nova', 'Echo', 'Pixel', 'Zephyr', 'Astro', 'Iris', 'Orbit', 'Comet'];
  const LS = { SETTINGS: 'cascade_settings', STATS: 'cascade_stats', SAVE: 'cascade_save' };

  // ── Persistance ─────────────────────────────────────────────────────
  const readJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const defaultSettings = () => ({ sound: true, music: false, anim: true, theme: 'dark', aiSpeed: 600 });
  let settings = Object.assign(defaultSettings(), readJSON(LS.SETTINGS, {}));
  const saveSettings = () => writeJSON(LS.SETTINGS, settings);

  const defaultStats = () => ({ games: 0, wins: 0, best: null, rounds: 0, columns: 0 });
  let stats = Object.assign(defaultStats(), readJSON(LS.STATS, {}));
  const saveStats = () => writeJSON(LS.STATS, stats);

  // ── État runtime du contrôleur ──────────────────────────────────────
  let S = null;                 // état du moteur (GameState)
  let cfg = null;               // { mode, humans:Set, players:[...] }
  let activeSeat = 0;           // siège en train de jouer (setup ou tour)
  let setupPtr = 0;             // pointeur de siège pendant la phase setup
  let lastShownHuman = -1;      // dernier humain "présenté" (pass-and-play)
  const animatedReveals = new Set(); // clés de cartes déjà animées (flip)
  let dealtRound = 0;           // manche dont la distribution a été animée
  let aiTimer = null;           // timeout IA en cours (annulable au quit)

  const isAI = (seat) => S.players[seat].isAI;

  // ── Overlay racine ──────────────────────────────────────────────────
  let el = null; // conteneur .cascade-app

  function ensureRoot() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'cascade-app';
    el.setAttribute('data-cascade-theme', settings.theme);
    el.setAttribute('data-cascade-anim', settings.anim ? 'on' : 'off');
    document.body.appendChild(el);
    return el;
  }
  function applyTheme() {
    if (!el) return;
    el.setAttribute('data-cascade-theme', settings.theme);
    el.setAttribute('data-cascade-anim', settings.anim ? 'on' : 'off');
  }
  function close() {
    clearTimeout(aiTimer);
    if (el) { el.remove(); el = null; }
  }

  // ── Effets : son (WebAudio) + haptique ──────────────────────────────
  let actx = null;
  function beep(freq, dur = 0.06, type = 'sine', gain = 0.05) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain; o.connect(g); g.connect(actx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur);
    } catch {}
  }
  const sfx = {
    flip:   () => beep(520, 0.05, 'triangle'),
    place:  () => beep(360, 0.07, 'sine'),
    clear:  () => { beep(660, 0.08, 'square', 0.04); setTimeout(() => beep(880, 0.1, 'square', 0.04), 90); },
    turn:   () => beep(300, 0.05, 'sine', 0.03),
    win:    () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.14, 'triangle', 0.05), i * 130)),
  };
  const haptic = (ms) => { try { if (settings.anim && navigator.vibrate) navigator.vibrate(ms); } catch {} };

  // ══════════════════════════════════════════════════════════════════
  // ÉCRAN : MENU PRINCIPAL
  // ══════════════════════════════════════════════════════════════════
  function launch() {
    ensureRoot();
    showMenu();
  }

  function topbar(title, opts = {}) {
    return `
      <div class="cascade-topbar">
        ${opts.back ? `<button class="cs-iconbtn" data-act="back">←</button>` : ''}
        <div class="cs-title">${title}</div>
        <div class="cs-spacer"></div>
        ${opts.close ? `<button class="cs-iconbtn" data-act="close">✕</button>` : ''}
      </div>`;
  }

  function showMenu() {
    clearTimeout(aiTimer);
    const save = readJSON(LS.SAVE, null);
    el.innerHTML = `
      ${topbar('CASCADE', { close: true })}
      <div class="cascade-scroll"><div class="cs-panel">
        <div class="cs-hero">
          <div class="cs-hero-logo">🎴</div>
          <div class="cs-hero-name">CASCADE</div>
          <div class="cs-hero-sub">Fais chuter ton score. Le plus bas gagne.</div>
        </div>
        ${save ? `<button class="cs-btn cs-btn--primary" data-act="resume">
          <span class="cs-btn-ico">▶️</span><span class="cs-btn-txt">Reprendre la partie</span></button>` : ''}
        <button class="cs-btn" data-act="setup-solo">
          <span class="cs-btn-ico">🤖</span><span class="cs-btn-txt">Solo contre l'IA<small>Affronte 1 à 5 adversaires</small></span></button>
        <button class="cs-btn" data-act="setup-local">
          <span class="cs-btn-ico">👥</span><span class="cs-btn-txt">Multijoueur local<small>Passez-vous l'appareil</small></span></button>
        <button class="cs-btn cs-btn--ghost" data-act="stats">
          <span class="cs-btn-ico">📊</span><span class="cs-btn-txt">Statistiques</span></button>
        <button class="cs-btn cs-btn--ghost" data-act="settings">
          <span class="cs-btn-ico">⚙️</span><span class="cs-btn-txt">Réglages</span></button>
        <button class="cs-btn cs-btn--ghost" data-act="rules">
          <span class="cs-btn-ico">❓</span><span class="cs-btn-txt">Règles du jeu</span></button>
      </div></div>`;
    bindMenu();
  }

  function bindMenu() {
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        haptic(8);
        if (a === 'close') close();
        else if (a === 'resume') resumeGame();
        else if (a === 'setup-solo') showSetup('solo');
        else if (a === 'setup-local') showSetup('local');
        else if (a === 'stats') showStats();
        else if (a === 'settings') showSettings();
        else if (a === 'rules') showRules();
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // ÉCRAN : CONFIGURATION DE PARTIE
  // ══════════════════════════════════════════════════════════════════
  let draft = null;
  function showSetup(mode) {
    // Brouillon de configuration modifiable avant de lancer.
    draft = {
      mode,
      count: mode === 'solo' ? 2 : 2,           // solo: 1 humain + N IA ; local: N humains
      level: 'medium',
      names: ['Toi', 'Copain', 'Ami·e', 'Invité', 'Joueur 5', 'Joueur 6'],
    };
    renderSetup();
  }

  function renderSetup() {
    const solo = draft.mode === 'solo';
    const maxP = 6;
    const counts = solo ? [2, 3, 4, 5, 6] : [2, 3, 4, 5, 6];
    el.innerHTML = `
      ${topbar(solo ? 'SOLO' : 'LOCAL', { back: 'menu', close: true })}
      <div class="cascade-scroll"><div class="cs-panel">
        <div class="cs-section-label">${solo ? 'Nombre de joueurs (toi + IA)' : 'Nombre de joueurs'}</div>
        <div class="cs-seg" data-group="count">
          ${counts.map((c) => `<button data-val="${c}" class="${c === draft.count ? 'active' : ''}">${c}</button>`).join('')}
        </div>
        ${solo ? `
          <div class="cs-section-label">Niveau des IA</div>
          <div class="cs-seg" data-group="level">
            <button data-val="easy"   class="${draft.level === 'easy' ? 'active' : ''}">😴 Facile</button>
            <button data-val="medium" class="${draft.level === 'medium' ? 'active' : ''}">🙂 Moyen</button>
            <button data-val="hard"   class="${draft.level === 'hard' ? 'active' : ''}">😈 Difficile</button>
          </div>` : ''}
        ${!solo ? `
          <div class="cs-section-label">Prénoms des joueurs</div>
          ${Array.from({ length: draft.count }, (_, i) => `
            <div class="cs-name-row">
              <span class="cs-ava">${AVATARS[i]}</span>
              <input data-name="${i}" maxlength="14" value="${escapeHtml(draft.names[i] || '')}" placeholder="Joueur ${i + 1}">
            </div>`).join('')}` : `
          <div class="cs-section-label">Ton prénom</div>
          <div class="cs-name-row"><span class="cs-ava">${AVATARS[0]}</span>
            <input data-name="0" maxlength="14" value="${escapeHtml(draft.names[0] || 'Toi')}"></div>`}
        <button class="cs-btn cs-btn--primary" data-go="1" style="margin-top:24px">🚀 Lancer la partie</button>
      </div></div>`;
    bindSetup();
  }

  function bindSetup() {
    el.querySelector('[data-act="back"]').onclick = showMenu;
    el.querySelector('[data-act="close"]').onclick = close;
    el.querySelectorAll('[data-group="count"] button').forEach((b) => {
      b.onclick = () => { draft.count = +b.dataset.val; haptic(6); renderSetup(); };
    });
    el.querySelectorAll('[data-group="level"] button').forEach((b) => {
      b.onclick = () => { draft.level = b.dataset.val; haptic(6); renderSetup(); };
    });
    el.querySelectorAll('input[data-name]').forEach((inp) => {
      inp.oninput = () => { draft.names[+inp.dataset.name] = inp.value; };
    });
    el.querySelector('[data-go]').onclick = startFromDraft;
  }

  function startFromDraft() {
    const solo = draft.mode === 'solo';
    const players = [];
    const humans = new Set();
    for (let i = 0; i < draft.count; i++) {
      if (solo) {
        if (i === 0) { players.push({ name: draft.names[0] || 'Toi', isAI: false }); humans.add(0); }
        else players.push({ name: AI_NAMES[i - 1], isAI: true, aiLevel: draft.level });
      } else {
        players.push({ name: draft.names[i] || `Joueur ${i + 1}`, isAI: false });
        humans.add(i);
      }
    }
    startGame({ mode: draft.mode, humans, players });
  }

  // ══════════════════════════════════════════════════════════════════
  // DÉMARRAGE / REPRISE
  // ══════════════════════════════════════════════════════════════════
  function startGame(config) {
    cfg = { mode: config.mode, humans: config.humans, players: config.players };
    S = E.newGame(config.players);
    animatedReveals.clear();
    dealtRound = 0;
    setupPtr = 0;
    lastShownHuman = -1;
    saveGame();
    runSeat();
  }

  function resumeGame() {
    const save = readJSON(LS.SAVE, null);
    if (!save) return showMenu();
    S = save.S;
    cfg = { mode: save.mode, humans: new Set(save.humans), players: save.players };
    animatedReveals.clear();
    // Marque toutes les cartes déjà visibles comme "déjà animées" pour ne
    // pas rejouer un flip massif à la reprise.
    S.players.forEach((p, pi) => p.grid.forEach((c, ci) => {
      if (c.faceUp) animatedReveals.add(`${pi}:${ci}:${c.value}`);
    }));
    dealtRound = S.round;
    setupPtr = 0;
    lastShownHuman = -1;
    runSeat();
  }

  function saveGame() {
    if (!S || S.phase === 'gameEnd') { localStorage.removeItem(LS.SAVE); return; }
    writeJSON(LS.SAVE, { S, mode: cfg.mode, humans: [...cfg.humans], players: cfg.players });
  }

  // ══════════════════════════════════════════════════════════════════
  // BOUCLE DE JEU : à qui de jouer ?
  // ══════════════════════════════════════════════════════════════════
  function runSeat() {
    if (!S) return;
    if (S.phase === 'gameEnd') { renderBoard(); return showGameEnd(); }
    if (S.phase === 'roundEnd') { renderBoard(); return showRoundEnd(); }

    if (S.phase === 'setup') {
      // Cherche le prochain siège devant encore révéler des cartes.
      let seat = 0;
      while (seat < S.players.length && E.initialFlipsLeft(S, seat) === 0) seat++;
      if (seat >= S.players.length) return; // sécurité (le moteur transitionne)
      setupPtr = seat; activeSeat = seat;
    } else { // 'turn'
      activeSeat = S.currentPlayer;
    }

    if (isAI(activeSeat)) {
      renderBoard();
      scheduleAI();
    } else {
      presentHuman(activeSeat, () => renderBoard());
    }
  }

  // Cérémonie "passe l'appareil" (multijoueur local) avant un tour humain.
  function presentHuman(seat, cb) {
    const needCeremony = cfg.mode === 'local' && seat !== lastShownHuman;
    lastShownHuman = seat;
    if (!needCeremony) { cb(); return; }
    sfx.turn();
    const p = S.players[seat];
    const over = document.createElement('div');
    over.className = 'cs-passover';
    over.innerHTML = `
      <div class="big-ava">${AVATARS[seat]}</div>
      <div class="to-name">À toi, ${escapeHtml(p.name)}</div>
      <div class="to-hint">${S.phase === 'setup' ? 'Révèle 2 cartes pour commencer' : 'Touche l\'écran quand tu es prêt·e'}</div>
      <button class="cs-btn cs-btn--primary" style="max-width:260px">C'est parti →</button>`;
    el.appendChild(over);
    const go = () => { over.remove(); haptic(8); cb(); };
    over.querySelector('button').onclick = go;
  }

  // ══════════════════════════════════════════════════════════════════
  // RENDU DU PLATEAU
  // ══════════════════════════════════════════════════════════════════
  function valueClass(v) {
    if (v < 0) return 'cs-v-neg';
    if (v === 0) return 'cs-v-zero';
    if (v <= 4) return 'cs-v-low';
    if (v <= 8) return 'cs-v-mid';
    return 'cs-v-high';
  }

  function cardHTML(cell, key, { selectable, highlight, deal } = {}) {
    if (cell.removed) return `<div class="cs-card" style="visibility:hidden"></div>`;
    const faceUp = cell.faceUp;
    const isNew = faceUp && !animatedReveals.has(key);
    if (isNew) animatedReveals.add(key);
    const cls = [
      'cs-card',
      faceUp ? 'face-up' : '',
      selectable ? 'selectable' : '',
      highlight ? 'highlight' : '',
      isNew ? 'flip-anim' : '',
      deal ? 'cs-deal' : '',
    ].join(' ');
    return `<div class="${cls}" data-card="${key}">
      <div class="cs-card-inner">
        <div class="cs-face cs-face-back">🎴</div>
        <div class="cs-face cs-face-front ${valueClass(cell.value)}">${faceUp ? cell.value : ''}</div>
      </div></div>`;
  }

  function miniGrid(grid) {
    return `<div class="cs-mini-grid">${grid.map((c) => {
      if (c.removed) return `<div class="cs-mini-cell removed"></div>`;
      if (!c.faceUp) return `<div class="cs-mini-cell hidden"></div>`;
      return `<div class="cs-mini-cell ${valueClass(c.value)}">${c.value}</div>`;
    }).join('')}</div>`;
  }

  function renderBoard() {
    const me = activeSeat;
    const isSetup = S.phase === 'setup';
    const humanActing = !isAI(me);
    const dealNow = S.round !== dealtRound; // première frame d'une manche
    if (dealNow) dealtRound = S.round;

    // Adversaires (tous sauf le siège actif), avec mini-grilles publiques.
    const opps = S.players.map((p, i) => ({ p, i })).filter((x) => x.i !== me);
    const oppHTML = opps.map(({ p, i }) => `
      <div class="cs-opp ${i === S.currentPlayer && !isSetup ? 'is-turn' : ''}">
        <div class="cs-opp-head">
          <span class="cs-opp-ava">${AVATARS[i]}</span>
          <span class="cs-opp-name">${escapeHtml(p.name)}</span>
          <span class="cs-opp-score">${p.totalScore}</span>
        </div>
        ${miniGrid(p.grid)}
      </div>`).join('');

    // Bandeau + zone centrale (pioche/défausse/carte en main).
    const banner = bannerText();
    const centerHTML = renderCenter();

    // Grille du joueur actif.
    const mineSelectable = humanActing && (S.phase === 'drawn' || S.phase === 'flip' || isSetup);
    const myGrid = S.players[me].grid.map((c, ci) => {
      const key = `${me}:${ci}:${c.value}`;
      let selectable = false, highlight = false;
      if (humanActing) {
        if (isSetup) selectable = !c.faceUp && !c.removed;
        else if (S.phase === 'drawn') selectable = !c.removed;         // remplacer n'importe laquelle
        else if (S.phase === 'flip') selectable = !c.faceUp && !c.removed; // révéler une cachée
      }
      return `<div data-slot="${ci}">${cardHTML(c, key, { selectable, highlight, deal: dealNow })}</div>`;
    }).join('');

    el.innerHTML = `
      ${topbar('CASCADE', { close: true })}
      <div class="cs-board">
        <div class="cs-opponents">${oppHTML}</div>
        <div class="cs-turn-banner">${banner}</div>
        ${centerHTML}
        ${renderActions()}
        <div class="cs-my-area">
          <div class="cs-my-head">
            <span class="cs-my-ava">${AVATARS[me]}</span>
            <span class="cs-my-name">${escapeHtml(S.players[me].name)}</span>
            <span class="cs-my-score">Manches : <b id="cs-mytotal">${S.players[me].totalScore}</b></span>
          </div>
          <div class="cs-my-grid">${myGrid}</div>
        </div>
      </div>`;

    bindBoard();
    // Effets déclenchés par les derniers événements du moteur.
    requestAnimationFrame(() => applyEventEffects());
  }

  function bannerText() {
    const name = escapeHtml(S.players[activeSeat].name);
    if (S.phase === 'setup') {
      return `<span class="hl">${name}</span> — révèle 2 cartes <span class="cs-hint">(reste ${E.initialFlipsLeft(S, activeSeat)})</span>`;
    }
    if (isAI(activeSeat)) return `<span class="hl">${name}</span> réfléchit… <span class="cs-hint">🤖</span>`;
    if (S.phase === 'turn') return `À toi, <span class="hl">${name}</span> <span class="cs-hint">— pioche ou prends la défausse</span>`;
    if (S.phase === 'drawn') {
      return state.drawnFromLabel();
    }
    if (S.phase === 'flip') return `Retourne une carte cachée <span class="cs-hint">de ton choix</span>`;
    return '';
  }
  // petit helper pour éviter une closure lourde dans bannerText
  const state = {
    drawnFromLabel() {
      if (S.drawnFrom === 'discard') return `Place la carte <span class="cs-hint">sur une de tes cartes</span>`;
      return `Garde-la (touche une carte) <span class="cs-hint">ou défausse-la</span>`;
    },
  };

  // Zone centrale : pioche, défausse et carte en main éventuelle.
  function renderCenter() {
    const top = E.topDiscard(S);
    const drawCell = { value: 0, faceUp: false, removed: false };
    const discCell = { value: top, faceUp: true, removed: false };
    const humanActing = !isAI(activeSeat);
    const canPickSource = humanActing && S.phase === 'turn';

    const drawnHTML = (S.phase === 'drawn')
      ? `<div class="cs-pile-wrap"><div class="cs-drawn">${cardHTML({ value: S.drawnCard, faceUp: true, removed: false }, `drawn:${S.drawnCard}:${Date.now()}`, {})}</div>
          <div class="cs-pile-label">En main</div></div>`
      : '';

    return `<div class="cs-center">
      <div class="cs-pile-wrap">
        <div class="cs-drawn ${canPickSource ? 'selectable-src' : ''}" data-src="draw">
          ${cardHTML(drawCell, 'pile-draw', { selectable: canPickSource })}
        </div>
        <div class="cs-pile-label">Pioche</div>
        <div class="cs-pile-count">${S.drawPile.length}</div>
      </div>
      ${drawnHTML}
      <div class="cs-pile-wrap">
        <div class="cs-drawn ${canPickSource ? 'selectable-src' : ''}" data-src="discard">
          ${cardHTML(discCell, `pile-disc:${top}`, { selectable: canPickSource })}
        </div>
        <div class="cs-pile-label">Défausse</div>
      </div>
    </div>`;
  }

  function renderActions() {
    const humanActing = !isAI(activeSeat);
    if (!humanActing) return '';
    if (S.phase === 'drawn' && S.drawnFrom === 'draw') {
      return `<div class="cs-actions">
        <button class="cs-action" data-do="discardDrawn">🗑️ Défausser & retourner</button>
      </div>`;
    }
    return `<div class="cs-actions"><span style="height:2px"></span></div>`;
  }

  // ── Liaisons d'événements du plateau ────────────────────────────────
  function bindBoard() {
    el.querySelector('[data-act="close"]').onclick = confirmQuit;

    // Choix de la source (pioche / défausse).
    el.querySelectorAll('[data-src]').forEach((node) => {
      const inner = node.querySelector('.cs-card.selectable');
      if (!inner) return;
      node.onclick = () => {
        if (S.phase !== 'turn' || isAI(activeSeat)) return;
        haptic(8);
        if (node.dataset.src === 'draw') { E.drawFromPile(S); sfx.flip(); }
        else { E.takeFromDiscard(S); sfx.place(); }
        renderBoard();
      };
    });

    // Actions (défausser la pioche → retourner).
    el.querySelectorAll('[data-do]').forEach((b) => {
      b.onclick = () => {
        if (isAI(activeSeat)) return;
        haptic(8);
        E.discardDrawn(S); sfx.place();
        renderBoard();
      };
    });

    // Cartes de la grille active.
    el.querySelectorAll('[data-slot] .cs-card.selectable').forEach((cardEl) => {
      const slot = +cardEl.closest('[data-slot]').dataset.slot;
      cardEl.onclick = () => onSlotTap(slot);
    });
  }

  function onSlotTap(slot) {
    if (isAI(activeSeat)) return;
    haptic(10);
    if (S.phase === 'setup') {
      E.flipInitial(S, activeSeat, slot);
      sfx.flip();
      if (E.initialFlipsLeft(S, activeSeat) > 0 && S.phase === 'setup') {
        renderBoard(); // encore une carte à révéler pour ce joueur
      } else {
        // Ce joueur a fini : au suivant (le moteur passe en 'turn' au dernier).
        afterAction();
      }
      return;
    }
    if (S.phase === 'drawn') {
      E.replaceCard(S, slot); sfx.place(); haptic(14);
      afterAction();
    } else if (S.phase === 'flip') {
      E.flipCard(S, slot); sfx.flip();
      afterAction();
    }
  }

  // Après une action qui TERMINE (ou fait avancer) un tour/siège.
  function afterAction() {
    saveGame();
    renderBoard();                 // montre le résultat + effets
    // Laisse les animations respirer avant de passer la main.
    const delay = settings.anim ? 520 : 60;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => runSeat(), delay);
  }

  // ══════════════════════════════════════════════════════════════════
  // TOUR DE L'IA (décisions atomiques animées)
  // ══════════════════════════════════════════════════════════════════
  function scheduleAI() {
    const step = Math.max(180, settings.anim ? settings.aiSpeed : 120);
    clearTimeout(aiTimer);
    aiTimer = setTimeout(aiStep, step);
  }

  function aiStep() {
    if (!S || isAI(activeSeat) === false) return;

    if (S.phase === 'setup') {
      const idx = AI.chooseInitialFlip(S, activeSeat);
      E.flipInitial(S, activeSeat, idx); sfx.flip();
      renderBoard();
      if (S.phase === 'setup' && E.initialFlipsLeft(S, activeSeat) > 0) return scheduleAI();
      return void (aiTimer = setTimeout(runSeat, settings.aiSpeed));
    }

    if (S.phase === 'turn') {
      const src = AI.chooseSource(S);
      if (src === 'discard') { E.takeFromDiscard(S); sfx.place(); }
      else { E.drawFromPile(S); sfx.flip(); }
      renderBoard();
      return scheduleAI();
    }

    if (S.phase === 'drawn') {
      const d = AI.afterDraw(S);
      if (d.action === 'replace') { E.replaceCard(S, d.index); sfx.place(); haptic(12); }
      else { E.discardDrawn(S); sfx.place(); }
      saveGame(); renderBoard();
      return scheduleAI();
    }

    if (S.phase === 'flip') {
      E.flipCard(S, AI.chooseFlip(S)); sfx.flip();
      saveGame(); renderBoard();
      return scheduleAI();
    }

    // Le tour a changé de main / la manche est finie.
    saveGame();
    aiTimer = setTimeout(runSeat, settings.aiSpeed);
  }

  // ══════════════════════════════════════════════════════════════════
  // EFFETS VISUELS déclenchés par les événements du moteur
  // ══════════════════════════════════════════════════════════════════
  function applyEventEffects() {
    if (!S.lastEvents) return;
    let flash = false;
    S.lastEvents.forEach((ev) => {
      if (ev.type === 'columnCleared') {
        sfx.clear(); haptic([12, 30, 12]);
        stats.columns++; saveStats();
        burstColumnParticles(ev);
        flash = true;
      }
      if (ev.type === 'finalTurn') { haptic(20); }
    });
    if (flash) glowFlash();
  }

  // Particules émises depuis les mini-grilles adverses (ou grille active).
  function burstColumnParticles(ev) {
    if (!settings.anim) return;
    // Cible : si c'est le siège actif, on connaît la position des cartes.
    const board = el.querySelector('.cs-board');
    const rect = board ? board.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#7c5cff', '#23d5c4', '#ffb648', '#ff5b6e', '#7ef7b0'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('div');
      p.className = 'cs-particle';
      p.style.left = cx + 'px'; p.style.top = cy + 'px';
      p.style.background = colors[i % colors.length];
      const ang = (Math.PI * 2 * i) / 18 + Math.random();
      const dist = 80 + Math.random() * 120;
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 850);
    }
  }

  function glowFlash() {
    if (!settings.anim) return;
    const g = document.createElement('div');
    g.className = 'cs-glow-flash';
    el.appendChild(g);
    setTimeout(() => g.remove(), 650);
  }

  // ══════════════════════════════════════════════════════════════════
  // MODALES : FIN DE MANCHE / FIN DE PARTIE
  // ══════════════════════════════════════════════════════════════════
  function scoreRows(scoresRound, totals, closer, doubled, winner) {
    const order = S.players.map((p, i) => ({ p, i }))
      .sort((a, b) => totals[a.i] - totals[b.i]);
    const medal = ['🥇', '🥈', '🥉'];
    return order.map((x, rank) => `
      <div class="cs-score-row ${x.i === winner ? 'winner' : ''}">
        <div class="rank">${medal[rank] || (rank + 1)}</div>
        <div class="who">${AVATARS[x.i]} ${escapeHtml(x.p.name)}
          ${x.i === closer && doubled ? '<span class="cs-badge-double">×2</span>' : ''}
          <small>Total : ${totals[x.i]}</small></div>
        <div class="pts"><span class="rnd">+${scoresRound[x.i]}</span></div>
      </div>`).join('');
  }

  function showRoundEnd() {
    const r = S.roundResult;
    stats.rounds++; saveStats(); saveGame();
    const back = document.createElement('div');
    back.className = 'cs-modal-back';
    back.innerHTML = `
      <div class="cs-modal">
        <h2>🎴 Fin de manche ${r.round}</h2>
        <div class="cs-modal-sub">${escapeHtml(S.players[r.closer].name)} a complété sa grille${r.doubled ? ' — score doublé !' : ''}</div>
        ${scoreRows(r.finalScores, r.totals, r.closer, r.doubled, null)}
        <button class="cs-btn cs-btn--primary" data-next="1" style="margin-top:18px">Manche suivante →</button>
      </div>`;
    el.appendChild(back);
    back.querySelector('[data-next]').onclick = () => {
      back.remove();
      E.startNextRound(S);
      animatedReveals.clear();
      lastShownHuman = -1;
      saveGame();
      runSeat();
    };
  }

  function showGameEnd() {
    const r = S.roundResult;
    const winner = S.winner;
    // Statistiques.
    stats.games++;
    const humanWon = cfg.humans.has(winner);
    if (humanWon) stats.wins++;
    const myTotal = [...cfg.humans].map((i) => S.players[i].totalScore).sort((a, b) => a - b)[0];
    if (myTotal != null && (stats.best == null || myTotal < stats.best)) stats.best = myTotal;
    saveStats();
    localStorage.removeItem(LS.SAVE);
    sfx.win(); haptic([20, 40, 20, 40, 60]);

    const back = document.createElement('div');
    back.className = 'cs-modal-back';
    back.innerHTML = `
      <div class="cs-modal">
        <h2>🏆 ${escapeHtml(S.players[winner].name)} gagne !</h2>
        <div class="cs-modal-sub">Score final le plus bas de la table</div>
        ${scoreRows(r ? r.finalScores : S.players.map(() => 0), S.players.map((p) => p.totalScore), r ? r.closer : -1, false, winner)}
        <button class="cs-btn cs-btn--primary" data-replay="1" style="margin-top:18px">🔄 Rejouer</button>
        <button class="cs-btn cs-btn--ghost" data-menu="1">🏠 Menu</button>
      </div>`;
    el.appendChild(back);
    back.querySelector('[data-replay]').onclick = () => { back.remove(); startGame(cfg); };
    back.querySelector('[data-menu]').onclick = () => { back.remove(); showMenu(); };
  }

  // ══════════════════════════════════════════════════════════════════
  // STATS / RÉGLAGES / RÈGLES
  // ══════════════════════════════════════════════════════════════════
  function showStats() {
    const winRate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
    el.innerHTML = `
      ${topbar('STATISTIQUES', { back: 'menu', close: true })}
      <div class="cascade-scroll"><div class="cs-panel">
        <div class="cs-stat-grid">
          <div class="cs-stat"><div class="num">${stats.games}</div><div class="lbl">Parties jouées</div></div>
          <div class="cs-stat"><div class="num">${stats.wins}</div><div class="lbl">Victoires</div></div>
          <div class="cs-stat"><div class="num">${winRate}%</div><div class="lbl">Taux de victoire</div></div>
          <div class="cs-stat"><div class="num">${stats.best == null ? '—' : stats.best}</div><div class="lbl">Meilleur score</div></div>
          <div class="cs-stat"><div class="num">${stats.rounds}</div><div class="lbl">Manches jouées</div></div>
          <div class="cs-stat"><div class="num">${stats.columns}</div><div class="lbl">Colonnes cassées</div></div>
        </div>
        <button class="cs-btn cs-btn--ghost" data-reset="1" style="margin-top:20px">🗑️ Réinitialiser les stats</button>
      </div></div>`;
    el.querySelector('[data-act="back"]').onclick = showMenu;
    el.querySelector('[data-act="close"]').onclick = close;
    el.querySelector('[data-reset]').onclick = () => { stats = defaultStats(); saveStats(); showStats(); };
  }

  function toggle(label, key) {
    return `<div class="cs-toggle-row"><span class="lbl">${label}</span>
      <div class="cs-switch ${settings[key] ? 'on' : ''}" data-toggle="${key}"></div></div>`;
  }

  function showSettings() {
    el.innerHTML = `
      ${topbar('RÉGLAGES', { back: 'menu', close: true })}
      <div class="cascade-scroll"><div class="cs-panel">
        ${toggle('🔊 Sons', 'sound')}
        ${toggle('🎵 Musique', 'music')}
        ${toggle('✨ Animations', 'anim')}
        <div class="cs-section-label">Thème</div>
        <div class="cs-seg" data-group="theme">
          <button data-val="dark"  class="${settings.theme === 'dark' ? 'active' : ''}">🌙 Sombre</button>
          <button data-val="light" class="${settings.theme === 'light' ? 'active' : ''}">☀️ Clair</button>
        </div>
        <div class="cs-section-label">Vitesse de l'IA</div>
        <div class="cs-seg" data-group="speed">
          <button data-val="900" class="${settings.aiSpeed >= 800 ? 'active' : ''}">🐢 Lente</button>
          <button data-val="600" class="${settings.aiSpeed >= 400 && settings.aiSpeed < 800 ? 'active' : ''}">🚶 Normale</button>
          <button data-val="280" class="${settings.aiSpeed < 400 ? 'active' : ''}">⚡ Rapide</button>
        </div>
      </div></div>`;
    el.querySelector('[data-act="back"]').onclick = showMenu;
    el.querySelector('[data-act="close"]').onclick = close;
    el.querySelectorAll('[data-toggle]').forEach((sw) => {
      sw.onclick = () => {
        const k = sw.dataset.toggle;
        settings[k] = !settings[k]; saveSettings(); applyTheme();
        sw.classList.toggle('on', settings[k]);
        if (k === 'sound' && settings[k]) sfx.flip();
      };
    });
    el.querySelectorAll('[data-group="theme"] button').forEach((b) => {
      b.onclick = () => { settings.theme = b.dataset.val; saveSettings(); applyTheme(); showSettings(); };
    });
    el.querySelectorAll('[data-group="speed"] button').forEach((b) => {
      b.onclick = () => { settings.aiSpeed = +b.dataset.val; saveSettings(); showSettings(); };
    });
  }

  function showRules() {
    el.innerHTML = `
      ${topbar('RÈGLES', { back: 'menu', close: true })}
      <div class="cascade-scroll"><div class="cs-panel" style="line-height:1.6">
        <div class="cs-section-label">But du jeu</div>
        <p>Avoir le <b>score le plus bas</b>. Chaque joueur a une grille de <b>3×4 cartes</b>, d'abord face cachée ; on en révèle 2 au départ.</p>
        <div class="cs-section-label">À ton tour</div>
        <p>Soit tu <b>pioches</b> (puis tu remplaces une carte, ou tu défausses et retournes une carte cachée), soit tu prends la carte du dessus de la <b>défausse</b> pour remplacer une de tes cartes.</p>
        <div class="cs-section-label">Colonnes</div>
        <p>Une colonne de <b>3 cartes identiques</b> est retirée du jeu (0 point) — vise les grosses valeurs !</p>
        <div class="cs-section-label">Fin</div>
        <p>Quand un joueur révèle toute sa grille, les autres jouent un dernier tour. Si le déclencheur n'a pas le score le plus bas, il est <b>doublé</b>. La partie s'arrête dès qu'un total atteint <b>100</b> : le plus bas total gagne.</p>
        <p style="color:var(--c-muted);font-size:12px;margin-top:20px">Cascade est une œuvre originale reprenant des mécaniques classiques de jeu de cartes.</p>
      </div></div>`;
    el.querySelector('[data-act="back"]').onclick = showMenu;
    el.querySelector('[data-act="close"]').onclick = close;
  }

  // ── Quitter la partie en cours ──────────────────────────────────────
  function confirmQuit() {
    clearTimeout(aiTimer);
    const back = document.createElement('div');
    back.className = 'cs-modal-back';
    back.innerHTML = `
      <div class="cs-modal">
        <h2>Quitter ?</h2>
        <div class="cs-modal-sub">La partie est sauvegardée automatiquement, tu pourras la reprendre.</div>
        <button class="cs-btn cs-btn--primary" data-stay="1">Continuer la partie</button>
        <button class="cs-btn cs-btn--ghost" data-menu="1">Retour au menu</button>
        <button class="cs-btn cs-btn--ghost" data-quit="1">Fermer Cascade</button>
      </div>`;
    el.appendChild(back);
    back.querySelector('[data-stay]').onclick = () => { back.remove(); runSeat(); };
    back.querySelector('[data-menu]').onclick = () => { back.remove(); showMenu(); };
    back.querySelector('[data-quit]').onclick = () => { back.remove(); close(); };
  }

  // ── Utilitaire ──────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // ── API publique ────────────────────────────────────────────────────
  root.Cascade = { launch, close };

})(typeof window !== 'undefined' ? window : globalThis);
