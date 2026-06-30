// ══════════════════════════════════════
// games/undercover.js — L'Undercover Ultime
// ══════════════════════════════════════
//
// Jeu de déduction 3–20 joueurs. Chacun reçoit un mot secret : la majorité
// (les Civils) partage le même mot, l'Undercover en a un proche mais
// différent, et Mr. White n'a aucun mot. À chaque tour, on décrit son mot
// par un indice, puis on vote pour éliminer un suspect.
//
// Contrairement aux autres jeux, le contenu (paires de mots, rôles
// spéciaux) est embarqué ici plutôt qu'en base : le jeu fonctionne sans
// migration Supabase. Le modèle reste celui de loups.js / cameleon.js :
// un seul render() retourné par mount(), le host pilote les éliminations,
// chaque joueur révèle son mot en privé (pass-the-phone).

// ── Banque de paires de mots (mot des Civils / mot de l'Undercover) ──────
const UNDERCOVER_PAIRS = [
  ['Chat', 'Tigre'], ['Café', 'Thé'], ['Pizza', 'Quiche'], ['Plage', 'Désert'],
  ['Vélo', 'Moto'], ['Soleil', 'Lune'], ['Pomme', 'Poire'], ['Guitare', 'Violon'],
  ['Train', 'Métro'], ['Neige', 'Pluie'], ['Chien', 'Loup'], ['Livre', 'Magazine'],
  ['Montre', 'Bracelet'], ['Avion', 'Hélicoptère'], ['Fraise', 'Framboise'],
  ['Océan', 'Lac'], ['Roi', 'Prince'], ['Cinéma', 'Théâtre'], ['Bière', 'Vin'],
  ['Crayon', 'Stylo'], ['Lion', 'Léopard'], ['Hiver', 'Automne'], ['Football', 'Rugby'],
  ['Boulangerie', 'Pâtisserie'], ['Piano', 'Orgue'], ['Tomate', 'Poivron'],
  ['Téléphone', 'Tablette'], ['Médecin', 'Infirmier'], ['Château', 'Palais'],
  ['Requin', 'Dauphin'], ['Casque', 'Chapeau'], ['Lampe', 'Bougie'],
  ['Voiture', 'Camion'], ['Miel', 'Sirop'], ['Pirate', 'Marin'], ['Glace', 'Sorbet'],
  ['Forêt', 'Jungle'], ['Sandwich', 'Burger'], ['Étoile', 'Planète'],
  ['Robot', 'Androïde'], ['Sorcière', 'Fée'], ['Cravate', 'Nœud papillon'],
  ['Clavier', 'Souris'], ['Pinceau', 'Rouleau'], ['Sirène', 'Méduse'],
];

// ── Définitions des rôles de base ────────────────────────────────────────
const UC_ROLES = {
  civil:     { label: 'Civil',      icon: '🧑‍🤝‍🧑', color: '#00d4aa',
               goal: 'Découvre ton identité et élimine l\'Undercover & Mr. White.' },
  undercover:{ label: 'Undercover', icon: '🕵️',     color: '#ff3d6b',
               goal: 'Découvre ton identité et survis jusqu\'à la fin.' },
  mrwhite:   { label: 'Mr. White',  icon: '🃏',     color: '#e6e6e6',
               goal: 'Survis jusqu\'à la fin… ou devine le mot secret des Civils.' },
};

// ── Rôles spéciaux optionnels ────────────────────────────────────────────
// kind 'player'  : attribué à un joueur précis (révélé en privé).
// kind 'pair'    : attribué à deux joueurs liés.
// kind 'mode'    : règle globale (pas d'attribution individuelle).
const UC_SPECIALS = {
  deesse:    { kind:'player', min:3, name:'La Déesse de la Justice', icon:'⚖️',
               flavor:'En cas d\'égalité des votes, tu décides qui est éliminé. Tu gardes ce pouvoir même après ta propre élimination.' },
  amoureux:  { kind:'pair',   min:5, name:'Les Amoureux', icon:'💞',
               flavor:'Tu es secrètement amoureux(se) d\'un autre joueur. Si l\'un de vous est éliminé, l\'autre l\'est aussi.' },
  meme:      { kind:'mode',   min:3, name:'Mr. Meme', icon:'🤹',
               flavor:'À chaque tour, un joueur désigné doit décrire son mot uniquement par des gestes. N\'activez ce mode que si tout le monde se voit.' },
  vengeur:   { kind:'player', min:5, name:'La Vengeuse', icon:'🗡️',
               flavor:'Si tu es éliminé(e), tu emportes quelqu\'un d\'autre avec toi.' },
  duel:      { kind:'pair',   min:5, name:'Les Duellistes', icon:'⚔️',
               flavor:'Tu es en duel secret avec un autre joueur. Le premier éliminé perd 2 points, l\'autre en gagne 2.' },
  fantome:   { kind:'mode',   min:3, name:'Le Fantôme', icon:'👻',
               flavor:'Une fois éliminés, les joueurs continuent de hanter la partie : ils participent aux discussions et aux votes.' },
  falafel:   { kind:'player', min:4, name:'Le Vendeur de Falafels', icon:'🧆',
               flavor:'Tu offres un falafel spécial à un autre joueur : protection… ou sabotage. À vous de tenter votre chance !' },
  boomerang: { kind:'player', min:3, name:'Le Boomerang', icon:'🪃',
               flavor:'La première fois que tu reçois la majorité des votes, ils rebondissent sur ceux qui les ont exprimés. Une seule fois !' },
  foudejoie: { kind:'player', min:3, name:'Le Fou de Joie', icon:'🤪',
               flavor:'Si tu es le tout premier joueur éliminé par un vote, tu gagnes 4 points bonus !' },
};

// Liste de rôles spéciaux jouée par défaut quand le host n'a rien coché.
// (vide : le jeu de base se lance directement.)

// ── Helpers ──────────────────────────────────────────────────────────────

// Combien d'Undercover au maximum pour `n` joueurs, en gardant toujours
// une majorité de Civils.
function _ucMaxUndercover(n) {
  return Math.max(1, Math.floor((n - 1) / 3));
}

// Pioche `k` ids distincts au hasard parmi `pool`.
function _ucPick(pool, k) {
  return shuffle(pool).slice(0, k);
}

// Tue `ids` et propage la mort aux Amoureux. Retourne { alive, killed }
// où `killed` liste *tous* les ids réellement éliminés (chaîne comprise).
function _ucResolveKills(alive, ids, lovers) {
  const dead = new Set();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift();
    if (dead.has(id) || !alive.includes(id)) continue;
    dead.add(id);
    if (lovers && lovers.includes(id)) {
      const partner = lovers.find(x => x !== id);
      if (partner && !dead.has(partner)) queue.push(partner);
    }
  }
  return {
    alive: alive.filter(id => !dead.has(id)),
    killed: [...dead],
  };
}

// Composition des vivants → vainqueur éventuel, ou null si la partie continue.
function _ucWinner(s, players) {
  const roleOf = id => s.roles[id];
  const alive = s.alive;
  const civils = alive.filter(id => roleOf(id) === 'civil').length;
  const under  = alive.filter(id => roleOf(id) === 'undercover').length;
  const white  = alive.filter(id => roleOf(id) === 'mrwhite').length;
  const infil  = under + white;
  if (infil === 0) return 'civils';
  // Parité atteinte : les infiltrés ne peuvent plus être votés à coup sûr.
  if (civils <= infil) return under > 0 ? 'undercover' : 'mrwhite';
  return null;
}

function _ucName(players, id) {
  const p = players.find(x => x.id === id);
  return p ? `${p.avatar} ${p.name}` : '?';
}

// Désigne le mime du tour courant (Mr. Meme) : rotation sur les vivants.
function _ucMimeId(s) {
  if (!s.modes.meme) return null;
  const order = s.descOrder.filter(id => s.alive.includes(id));
  if (!order.length) return null;
  return order[s.round % order.length];
}

GameEngines['undercover'] = {

  // initState ne fait que poser l'écran de configuration : c'est le host
  // qui choisit le nombre d'Undercover, Mr. White et les rôles spéciaux
  // avant la distribution des mots.
  initState(players) {
    const n = players.length;
    return {
      phase: 'setup',                 // setup | reveal | describe | vote | mrwhite_guess | end
      config: {
        undercover: 1,
        mrwhite: n >= 4,
        specials: {},                 // tag -> true
      },
      scores: Object.fromEntries(players.map(p => [p.id, 0])),
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('undercover', 'mount', { isHost, players: players.length });
    const n = players.length;

    const render = (s) => {
      // Tolère un state d'une version antérieure.
      s = { config:{ undercover:1, mrwhite:false, specials:{} }, modes:{}, ...s };
      root.innerHTML = '';
      const myId = me.id;

      // ════════════════════════════ SETUP ════════════════════════════
      if (s.phase === 'setup') {
        if (!isHost) {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🕵️ Undercover</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">🕵️</div>
              <div class="waiting-title">Préparation…</div>
              <div class="waiting-sub">Le host configure la partie.<br>Les mots arrivent !</div>
            </div>`;
          return;
        }
        const maxU = _ucMaxUndercover(n);
        const cfg = s.config;
        const specialRows = Object.entries(UC_SPECIALS).map(([tag, def]) => {
          const enabled = n >= def.min;
          const on = !!cfg.specials[tag];
          return `
            <button class="wolf-player-row" ${enabled ? '' : 'disabled'}
              style="${enabled ? '' : 'opacity:.35'};${on ? 'border-color:#ff9500;background:rgba(255,149,0,.08)' : ''}"
              onclick="ucToggleSpecial('${tag}')">
              <span style="font-size:22px">${def.icon}</span>
              <span style="flex:1;text-align:left">
                <span style="font-weight:700;font-size:14px">${def.name}</span>
                <span style="display:block;font-size:11px;color:var(--muted);line-height:1.4">${def.flavor}${enabled ? '' : ` — dès ${def.min} joueurs`}</span>
              </span>
              <span style="font-size:18px">${on ? '✅' : '⬜'}</span>
            </button>`;
        }).join('');

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🕵️ Undercover Ultime</div></div>
          <div class="game-body slide-up">
            <div class="section-label">NOMBRE D'UNDERCOVER</div>
            <div class="vote-grid" style="grid-template-columns:repeat(${maxU},1fr)">
              ${Array.from({ length: maxU }, (_, i) => i + 1).map(k => `
                <button class="vote-btn ${cfg.undercover === k ? 'selected' : ''}" onclick="ucSetUnder(${k})">${k}</button>
              `).join('')}
            </div>
            <button class="wolf-player-row" style="${cfg.mrwhite ? 'border-color:#ff9500;background:rgba(255,149,0,.08)' : ''}" onclick="ucToggleWhite()">
              <span style="font-size:22px">🃏</span>
              <span style="flex:1;text-align:left">
                <span style="font-weight:700;font-size:14px">Mr. White</span>
                <span style="display:block;font-size:11px;color:var(--muted)">Un joueur sans aucun mot. Recommandé dès 4 joueurs.</span>
              </span>
              <span style="font-size:18px">${cfg.mrwhite ? '✅' : '⬜'}</span>
            </button>
            <div class="section-label" style="margin-top:6px">RÔLES SPÉCIAUX (optionnels)</div>
            <div style="display:flex;flex-direction:column;gap:8px">${specialRows}</div>
            <button class="btn-primary" style="--g1:#ff3d6b;--g2:#7c3aed;margin-top:6px" onclick="ucStart()">🎬 DISTRIBUER LES MOTS</button>
          </div>`;

        window.ucSetUnder = (k) => { onStateChange({ ...s, config:{ ...cfg, undercover:k } }); render({ ...s, config:{ ...cfg, undercover:k } }); };
        window.ucToggleWhite = () => { const ns = { ...s, config:{ ...cfg, mrwhite:!cfg.mrwhite } }; onStateChange(ns); render(ns); };
        window.ucToggleSpecial = (tag) => {
          if (n < UC_SPECIALS[tag].min) return;
          const specials = { ...cfg.specials, [tag]: !cfg.specials[tag] };
          if (!specials[tag]) delete specials[tag];
          const ns = { ...s, config:{ ...cfg, specials } };
          onStateChange(ns); render(ns);
        };
        window.ucStart = () => {
          const ns = _ucDeal(players, cfg, s.scores);
          Logger.info('undercover', 'Distribution', { under: cfg.undercover, white: cfg.mrwhite, specials: Object.keys(cfg.specials) });
          onStateChange(ns); render(ns);
        };
        return;
      }

      // ═══════════════════════════ REVEAL ════════════════════════════
      // Pass-the-phone : chacun lit son mot et ses rôles spéciaux en privé.
      if (s.phase === 'reveal') {
        const currentId = s.revealOrder[s.revealIndex];
        const amRevealing = myId === currentId;
        const cp = players.find(p => p.id === currentId);

        if (amRevealing) {
          const role = UC_ROLES[s.roles[myId]];
          const word = s.words[myId];
          const mySpecials = (s.specialRoles[myId] || []);
          const loverPartner = s.lovers && s.lovers.includes(myId) ? s.lovers.find(x => x !== myId) : null;
          const duelPartner  = s.duel && s.duel.includes(myId) ? s.duel.find(x => x !== myId) : null;
          const falafelFrom  = s.falafelTo === myId ? s.falafelBy : null;

          const specialCards = mySpecials.map(tag => {
            const def = UC_SPECIALS[tag];
            let extra = '';
            if (tag === 'amoureux' && loverPartner) extra = `<br><strong>${_ucName(players, loverPartner)}</strong> est ton amoureux(se).`;
            if (tag === 'duel' && duelPartner)      extra = `<br>Ton rival : <strong>${_ucName(players, duelPartner)}</strong>.`;
            return `<div style="margin-top:12px;padding:12px;background:rgba(255,149,0,.1);border-radius:12px;border:1px solid rgba(255,149,0,.3)">
              <div style="font-size:11px;color:#ff9500;letter-spacing:1px;margin-bottom:4px">${def.icon} ${def.name.toUpperCase()}</div>
              <div style="font-size:13px;line-height:1.4">${def.flavor}${extra}</div>
            </div>`;
          }).join('');

          const falafelCard = falafelFrom ? `
            <div style="margin-top:12px;padding:12px;background:rgba(0,212,170,.1);border-radius:12px;border:1px solid rgba(0,212,170,.3)">
              <div style="font-size:11px;color:#00d4aa;letter-spacing:1px;margin-bottom:4px">🧆 TU AS REÇU UN FALAFEL</div>
              <div style="font-size:13px;line-height:1.4">Un joueur t'a offert un falafel spécial : protection… ou sabotage. Surprise !</div>
            </div>` : '';

          root.innerHTML = `
            <div class="game-header"><div class="game-title">🕵️ Undercover</div></div>
            <div class="game-body slide-up">
              <div style="text-align:center;color:var(--muted);font-size:12px;letter-spacing:2px">📵 ÉCRAN PRIVÉ — ${cp?.avatar} ${cp?.name}</div>
              <div class="role-reveal-card" style="--role-color:${role.color}">
                ${word ? `
                  <div class="section-label" style="margin-bottom:6px">TON MOT SECRET</div>
                  <div class="role-title-lg" style="color:${role.color}">${word.toUpperCase()}</div>
                  <div class="role-desc">Décris-le sans le dire. Trouve qui partage ton mot… et démasque les autres !</div>
                ` : `
                  <span class="role-emoji-lg">🃏</span>
                  <div class="role-title-lg" style="color:${role.color}">MR. WHITE</div>
                  <div class="role-desc">Tu n'as <strong>aucun mot</strong>. Bluffe, écoute, et devine le mot des Civils !</div>
                `}
                ${specialCards}
                ${falafelCard}
              </div>
              <button class="btn-primary" style="--g1:${role.color};--g2:#7c3aed" onclick="ucNextReveal()">J'AI VU MON MOT ›</button>
            </div>`;
          window.ucNextReveal = () => {
            const next = s.revealIndex + 1;
            const ns = next >= s.revealOrder.length ? _ucEnterDescribe(s, 0) : { ...s, revealIndex: next };
            onStateChange(ns); render(ns);
          };
        } else {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🕵️ Undercover</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">${cp?.avatar}</div>
              <div class="waiting-title">${cp?.name}</div>
              <div class="waiting-sub">découvre son mot secret…<br>Ne regardez pas son écran !</div>
            </div>`;
        }
        return;
      }

      // ══════════════════════════ DESCRIBE ═══════════════════════════
      if (s.phase === 'describe') {
        const alive = players.filter(p => s.alive.includes(p.id));
        const order = s.descOrder.filter(id => s.alive.includes(id));
        const mimeId = _ucMimeId(s);

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🕵️ Tour ${s.round + 1} — Descriptions</div></div>
          <div class="game-body slide-up">
            <div class="challenge-card" style="--card-color:#7c3aed">
              <div class="challenge-type">🗣️ À TOUR DE RÔLE</div>
              <div class="challenge-text">Chacun donne <strong>un mot</strong> qui décrit son mot secret — sans jamais le révéler !</div>
            </div>
            ${mimeId ? `<div class="challenge-card" style="--card-color:#ff9500">
              <div class="challenge-type">🤹 MR. MEME</div>
              <div class="challenge-text"><strong>${_ucName(players, mimeId)}</strong> doit décrire son mot uniquement par des gestes ce tour-ci !</div>
            </div>` : ''}
            <div class="section-label">ORDRE DE PAROLE</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${order.map((id, i) => `
                <div class="wolf-player-row" style="cursor:default;${id === mimeId ? 'border-color:#ff9500' : ''}">
                  <span style="opacity:.5;font-weight:700;width:20px">${i + 1}</span>
                  <span style="font-size:22px">${players.find(p => p.id === id)?.avatar}</span>
                  <span style="flex:1;text-align:left;font-weight:700">${players.find(p => p.id === id)?.name}</span>
                  ${id === mimeId ? '<span>🤹</span>' : ''}
                </div>`).join('')}
            </div>
            ${s.modes.fantome ? `<div style="font-size:12px;color:var(--muted);text-align:center">👻 Mode Fantôme : les éliminés participent toujours aux votes.</div>` : ''}
            ${isHost
              ? `<button class="btn-primary" style="--g1:#ff3d6b;--g2:#ff9500" onclick="ucToVote()">🗳️ PASSER AU VOTE →</button>`
              : `<div class="guest-waiting"><div class="pulse-dot"></div>Décrivez, débattez… puis le host lance le vote.</div>`}
          </div>`;
        if (isHost) window.ucToVote = () => { const ns = { ...s, phase:'vote', pending:null }; onStateChange(ns); render(ns); };
        return;
      }

      // ════════════════════════════ VOTE ═════════════════════════════
      if (s.phase === 'vote') {
        const alive = players.filter(p => s.alive.includes(p.id));
        const deesseAlive = s.deesseId; // garde le pouvoir même éliminée
        // pending : { killedNames, role, then } — petit récap après élimination

        if (!isHost) {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🗳️ Vote — Tour ${s.round + 1}</div></div>
            <div class="game-body slide-up">
              <div class="challenge-card" style="--card-color:#ff3d6b">
                <div class="challenge-type">🗳️ VOTE À MAIN LEVÉE</div>
                <div class="challenge-text">Désignez ensemble le joueur le plus suspect. Le host enregistre l'élimination.</div>
              </div>
              ${deesseAlive ? `<div style="font-size:12px;color:var(--muted);text-align:center">⚖️ En cas d'égalité, la Déesse de la Justice tranche.</div>` : ''}
              <div class="guest-waiting"><div class="pulse-dot"></div>En attente de l'élimination…</div>
            </div>`;
          return;
        }

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🗳️ Vote — Tour ${s.round + 1}</div></div>
          <div class="game-body slide-up">
            <div class="challenge-card" style="--card-color:#ff3d6b">
              <div class="challenge-type">🗳️ QUI EST ÉLIMINÉ ?</div>
              <div class="challenge-text">Touchez le joueur désigné par le vote.${s.deesseId ? ' En cas d\'égalité, ⚖️ la Déesse tranche.' : ''}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${alive.map(p => `
                <button class="wolf-player-row" onclick="ucEliminate('${p.id}')">
                  <span style="font-size:22px">${p.avatar}</span>
                  <span style="flex:1;text-align:left;font-weight:700">${p.name}</span>
                  ${s.boomerangId === p.id && !s.boomerangUsed ? '<span title="Boomerang">🪃</span>' : ''}
                </button>`).join('')}
            </div>
            <button class="btn-secondary" onclick="ucSkipVote()">Pas d'élimination ce tour</button>
          </div>`;

        window.ucSkipVote = () => { const ns = _ucEnterDescribe(s, s.round + 1); onStateChange(ns); render(ns); };
        window.ucEliminate = (pid) => {
          // Boomerang : la 1ʳᵉ fois, le vote rebondit — personne n'est éliminé.
          if (pid === s.boomerangId && !s.boomerangUsed) {
            showToast('🪃 Boomerang ! Le vote rebondit, personne n\'est éliminé.', 3500);
            const ns = _ucEnterDescribe({ ...s, boomerangUsed:true }, s.round + 1);
            setTimeout(() => { onStateChange(ns); render(ns); }, 1800);
            return;
          }
          const role = s.roles[pid];
          // Mr. White éliminé : il peut tenter de deviner le mot des Civils.
          if (role === 'mrwhite') {
            const ns = { ...s, phase:'mrwhite_guess', whiteId:pid };
            showToast(`${_ucName(players, pid)} était 🃏 Mr. White !`, 2600);
            setTimeout(() => { onStateChange(ns); render(ns); }, 800);
            return;
          }
          _ucApplyElimination(s, [pid], { byVote:true, players, onStateChange, render });
        };
        return;
      }

      // ═══════════════════════ MR. WHITE GUESS ═══════════════════════
      if (s.phase === 'mrwhite_guess') {
        const whiteName = _ucName(players, s.whiteId);
        const amWhite = myId === s.whiteId;
        root.innerHTML = `
          <div class="game-header"><div class="game-title">🃏 Mr. White</div></div>
          <div class="game-body slide-up">
            <div class="role-reveal-card" style="--role-color:#e6e6e6">
              <span class="role-emoji-lg">🃏</span>
              <div class="role-title-lg">${whiteName}</div>
              <div class="role-desc">${amWhite ? 'Tu es démasqué ! Dernière chance : <strong>annonce à voix haute</strong> le mot des Civils.' : `${whiteName} est démasqué et tente de deviner le mot des Civils…`}</div>
            </div>
            ${isHost ? `
              <div class="section-label">A-T-IL TROUVÉ LE MOT DES CIVILS ?</div>
              <div class="vote-grid">
                <button class="vote-btn" onclick="ucWhiteGuess(true)">✅ Oui, gagné !</button>
                <button class="vote-btn" onclick="ucWhiteGuess(false)">❌ Non</button>
              </div>
              <div style="font-size:12px;color:var(--muted);text-align:center">Le mot des Civils était : <strong>${s.pair.civil}</strong></div>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>Le host valide la réponse…</div>`}
          </div>`;
        if (isHost) window.ucWhiteGuess = (correct) => {
          if (correct) {
            const ns = { ...s, phase:'end', winner:'mrwhite', winnerWhiteId:s.whiteId };
            onStateChange(ns); render(ns); return;
          }
          // Raté : Mr. White est bel et bien éliminé, la partie continue.
          _ucApplyElimination({ ...s, phase:'vote' }, [s.whiteId], { byVote:true, players, onStateChange, render });
        };
        return;
      }

      // ════════════════════════ VENGEUR PICK ═════════════════════════
      if (s.phase === 'vengeur_pick') {
        const alive = players.filter(p => s.alive.includes(p.id));
        const vName = _ucName(players, s.vengeurPending);
        if (!isHost) {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🗡️ La Vengeuse</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">🗡️</div>
              <div class="waiting-title">${vName}</div>
              <div class="waiting-sub">emporte quelqu'un dans sa chute…</div>
            </div>`;
          return;
        }
        root.innerHTML = `
          <div class="game-header"><div class="game-title">🗡️ La Vengeuse</div></div>
          <div class="game-body slide-up">
            <div class="challenge-card" style="--card-color:#ff3d6b">
              <div class="challenge-type">🗡️ VENGEANCE</div>
              <div class="challenge-text"><strong>${vName}</strong> a été éliminé(e) et emporte un joueur avec elle. Qui ?</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${alive.map(p => `
                <button class="wolf-player-row" onclick="ucVengeur('${p.id}')">
                  <span style="font-size:22px">${p.avatar}</span>
                  <span style="flex:1;text-align:left;font-weight:700">${p.name}</span>
                </button>`).join('')}
            </div>
          </div>`;
        window.ucVengeur = (pid) => {
          _ucApplyElimination({ ...s, phase:'vote' }, [pid], { byVote:false, players, onStateChange, render, fromVengeur:true });
        };
        return;
      }

      // ════════════════════════════ END ══════════════════════════════
      if (s.phase === 'end') {
        const scores = _ucFinalScores(s, players);
        const win = s.winner;
        const banner = {
          civils:     { icon:'🧑‍🤝‍🧑', title:'LES CIVILS GAGNENT !', color:'#00d4aa', sub:'Tous les infiltrés ont été démasqués !' },
          undercover: { icon:'🕵️',     title:'L\'UNDERCOVER GAGNE !', color:'#ff3d6b', sub:'L\'infiltré a survécu jusqu\'au bout !' },
          mrwhite:    { icon:'🃏',     title:'MR. WHITE GAGNE !',   color:'#e6e6e6', sub:'Le bluff parfait jusqu\'à la fin !' },
        }[win];

        root.innerHTML = `
          <div class="game-header"><div class="game-title">🏁 Fin de partie</div></div>
          <div class="game-body slide-up">
            <div class="role-reveal-card" style="--role-color:${banner.color}">
              <span class="role-emoji-lg">${banner.icon}</span>
              <div class="role-title-lg" style="color:${banner.color}">${banner.title}</div>
              <div class="role-desc">${banner.sub}</div>
              <div style="margin-top:14px;font-size:12px;color:var(--muted)">Les mots étaient — Civils : <strong style="color:var(--text)">${s.pair.civil}</strong> · Undercover : <strong style="color:var(--text)">${s.pair.undercover}</strong></div>
              <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">
                ${players.map(p => {
                  const r = UC_ROLES[s.roles[p.id]];
                  const dead = !s.alive.includes(p.id);
                  return `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,.04);border-radius:10px;${dead ? 'opacity:.55' : ''}">
                    <span>${p.avatar}</span>
                    <span style="flex:1;font-weight:700">${p.name}</span>
                    <span style="font-size:16px">${r.icon}</span>
                    <span style="font-size:11px;color:var(--muted)">${r.label}${dead ? ' ☠️' : ''}</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
            <div id="uc-scoreboard"></div>
          </div>`;
        renderScoreboard(document.getElementById('uc-scoreboard'), players, scores, {
          onReplay: isHost ? () => { const ns = GameEngines.undercover.initState(players); onStateChange(ns); render(ns); } : null,
          onHome: onEnd,
        });
        return;
      }
    };

    render(state);
    return render;
  },
};

// ── Distribution des rôles, mots et rôles spéciaux ───────────────────────
function _ucDeal(players, cfg, baseScores) {
  const n = players.length;
  const pair = UNDERCOVER_PAIRS[Math.floor(Math.random() * UNDERCOVER_PAIRS.length)];
  // On randomise quel mot de la paire est celui de la majorité.
  const [civilWord, underWord] = Math.random() < 0.5 ? pair : [pair[1], pair[0]];

  const ids = shuffle(players.map(p => p.id));
  const roles = {};
  let i = 0;
  const nWhite = cfg.mrwhite ? 1 : 0;
  const nUnder = Math.min(cfg.undercover, _ucMaxUndercover(n));
  for (let k = 0; k < nWhite; k++) roles[ids[i++]] = 'mrwhite';
  for (let k = 0; k < nUnder; k++) roles[ids[i++]] = 'undercover';
  while (i < ids.length) roles[ids[i++]] = 'civil';

  const words = Object.fromEntries(players.map(p => {
    const r = roles[p.id];
    return [p.id, r === 'civil' ? civilWord : r === 'undercover' ? underWord : null];
  }));

  // ── Rôles spéciaux ──
  const specialRoles = {};            // id -> [tags]
  const modes = {};                   // tag -> true (règles globales)
  const addSpecial = (id, tag) => { (specialRoles[id] = specialRoles[id] || []).push(tag); };
  const allIds = players.map(p => p.id);
  let lovers = null, duel = null, deesseId = null, vengeurId = null,
      boomerangId = null, foudejoieId = null, falafelBy = null, falafelTo = null;

  Object.keys(cfg.specials).forEach(tag => {
    const def = UC_SPECIALS[tag];
    if (!def || n < def.min) return;
    if (def.kind === 'mode') { modes[tag] = true; return; }
    if (def.kind === 'pair') {
      const [a, b] = _ucPick(allIds, 2);
      addSpecial(a, tag); addSpecial(b, tag);
      if (tag === 'amoureux') lovers = [a, b];
      if (tag === 'duel') duel = [a, b];
      return;
    }
    // kind 'player'
    if (tag === 'falafel') {
      const [vendeur] = _ucPick(allIds, 1);
      const receiver = _ucPick(allIds.filter(x => x !== vendeur), 1)[0];
      addSpecial(vendeur, tag);
      falafelBy = vendeur; falafelTo = receiver;
      return;
    }
    const [pick] = _ucPick(allIds, 1);
    addSpecial(pick, tag);
    if (tag === 'deesse') deesseId = pick;
    if (tag === 'vengeur') vengeurId = pick;
    if (tag === 'boomerang') boomerangId = pick;
    if (tag === 'foudejoie') foudejoieId = pick;
  });

  return {
    phase: 'reveal',
    config: cfg,
    pair: { civil: civilWord, undercover: underWord },
    roles,
    words,
    specialRoles,
    modes,
    lovers, duel, deesseId, vengeurId, boomerangId, foudejoieId,
    falafelBy, falafelTo,
    boomerangUsed: false,
    firstVoteDone: false,
    duelLoser: null,
    alive: allIds,
    revealOrder: shuffle(allIds),
    revealIndex: 0,
    descOrder: shuffle(allIds),
    round: 0,
    scores: baseScores || Object.fromEntries(players.map(p => [p.id, 0])),
  };
}

// Entre dans la phase de description du tour `round` (recalcule l'ordre).
function _ucEnterDescribe(s, round) {
  return { ...s, phase: 'describe', round };
}

// Applique une élimination (vote, vengeance, amoureux…), gère les chaînes
// et enchaîne sur la bonne phase suivante. Pousse l'état lui-même.
function _ucApplyElimination(s, ids, { byVote, players, onStateChange, render, fromVengeur }) {
  let st = { ...s };
  const { alive, killed } = _ucResolveKills(st.alive, ids, st.lovers);
  st.alive = alive;

  // Premier vote : Fou de Joie / suivi du Duelliste.
  if (byVote && !st.firstVoteDone) st = { ...st, firstVoteDone: true, firstVoteKilled: killed };

  // Duellistes : le premier des deux à tomber est le perdant.
  if (st.duel && !st.duelLoser) {
    const loser = killed.find(id => st.duel.includes(id));
    if (loser) st.duelLoser = loser;
  }

  // Message de révélation des rôles éliminés.
  const msg = killed.map(id => {
    const r = UC_ROLES[st.roles[id]];
    return `${_ucName(players, id)} était ${r.icon} ${r.label}`;
  }).join(' · ');
  if (msg) showToast(msg + ' !', 3200);

  // Vengeuse : si une Vengeuse vient d'être éliminée (et pas déjà en train
  // de se venger), elle emporte quelqu'un. On évite la boucle infinie en
  // ne déclenchant la vengeance qu'une fois par Vengeuse.
  const vengeurKilled = !fromVengeur && st.vengeurId && killed.includes(st.vengeurId) && !st.vengeurDone;
  if (vengeurKilled && st.alive.length > 0) {
    st = { ...st, phase: 'vengeur_pick', vengeurPending: st.vengeurId, vengeurDone: true };
    setTimeout(() => { onStateChange(st); render(st); }, 1600);
    return;
  }

  // Fin de partie ?
  const winner = _ucWinner(st, players);
  if (winner) {
    st = { ...st, phase: 'end', winner };
  } else {
    st = _ucEnterDescribe(st, st.round + 1);
  }
  setTimeout(() => { onStateChange(st); render(st); }, msg ? 1600 : 0);
}

// Scores finaux : base selon le camp vainqueur + bonus des rôles spéciaux.
function _ucFinalScores(s, players) {
  const scores = { ...s.scores };
  const add = (id, pts) => { scores[id] = (scores[id] || 0) + pts; };
  const win = s.winner;

  players.forEach(p => {
    const r = s.roles[p.id];
    if (win === 'civils' && r === 'civil') add(p.id, 4);
    if (win === 'undercover' && r === 'undercover') add(p.id, 8);
    if (win === 'mrwhite' && r === 'mrwhite') add(p.id, 8);
    // Survivre rapporte toujours un petit quelque chose côté infiltrés.
    if (win !== 'civils' && (r === 'undercover' || r === 'mrwhite') && s.alive.includes(p.id)) add(p.id, 2);
  });

  // Fou de Joie : +4 s'il est le tout premier éliminé par vote.
  if (s.foudejoieId && (s.firstVoteKilled || []).includes(s.foudejoieId)) add(s.foudejoieId, 4);

  // Duellistes : le premier tombé perd 2, l'autre gagne 2.
  if (s.duel && s.duelLoser) {
    const winnerDuel = s.duel.find(x => x !== s.duelLoser);
    add(s.duelLoser, -2);
    if (winnerDuel) add(winnerDuel, 2);
  }

  return scores;
}
