// ══════════════════════════════════════
// games/loups.js
// ══════════════════════════════════════

const LOUP_ROLE_INFO = {
  'Villageois':  { icon:'👨‍🌾', color:'#00aaff', desc:'Trouvez et éliminez les loups par vote !', team:'village' },
  'Loup-Garou':  { icon:'🐺', color:'#ff3d6b', desc:'La nuit, concertez-vous pour éliminer un villageois.', team:'loups' },
  'Voyante':     { icon:'🔮', color:'#7c3aed', desc:'Chaque nuit, découvrez le rôle d\'un joueur.', team:'village' },
  'Sorcière':    { icon:'🧙‍♀️', color:'#00d4aa', desc:'Vous avez 2 potions : vie et mort. Une fois chacune.', team:'village' },
  'Chasseur':    { icon:'🏹', color:'#ff9500', desc:'Si vous mourez, emmenez un joueur avec vous !', team:'village' },
};

function buildRolePool(n) {
  const nLoups     = Math.max(1, Math.floor(n / 4));
  const hasVoyante = n >= 4;
  const hasSorciere= n >= 5;
  const hasChasseur= n >= 6;
  const special = (hasVoyante?1:0)+(hasSorciere?1:0)+(hasChasseur?1:0);
  const nVillage = n - nLoups - special;

  let pool = [];
  for (let i=0;i<Math.max(0,nVillage);i++) pool.push('Villageois');
  for (let i=0;i<nLoups;i++) pool.push('Loup-Garou');
  if (hasVoyante)  pool.push('Voyante');
  if (hasSorciere) pool.push('Sorcière');
  if (hasChasseur) pool.push('Chasseur');
  return shuffle(pool).slice(0,n);
}

GameEngines['loups'] = {

  initState(players) {
    const pool = buildRolePool(players.length);
    const roles = Object.fromEntries(players.map((p,i) => [p.id, pool[i]||'Villageois']));
    const alive = players.map(p=>p.id);
    const scores = Object.fromEntries(players.map(p=>[p.id,0]));
    return {
      phase: 'reveal',        // reveal | day | night | end
      revealIndex: 0,
      revealOrder: players.map(p=>p.id),
      roles,
      alive,
      scores,
      round: 0,
    };
  },

  mount(root, state, players, me, isHost, onStateChange, onEnd) {
    Logger.info('loups', 'mount', { isHost, players: players.length });
    let _sub = null;
    const unsub = () => { if (_sub) { DB.unsub(_sub); _sub = null; } };

    const render = (s) => {
      unsub();
      Logger.debug('loups', 'render phase=', s.phase, 'round=', s.round);
      root.innerHTML='';

      const g = { g1:'#1e3a8a', g2:'#00aaff' };

      // ── Win check
      const alivePlayers = players.filter(p => s.alive.includes(p.id));
      const nLoups   = alivePlayers.filter(p => s.roles[p.id]==='Loup-Garou').length;
      const nVillage = alivePlayers.length - nLoups;

      if (s.phase === 'reveal') {
        const currentId = s.revealOrder[s.revealIndex];
        const amRevealing = me.id === currentId;
        const cp = players.find(p=>p.id===currentId);
        const myRole   = s.roles[me.id];
        const ri       = LOUP_ROLE_INFO[myRole] || LOUP_ROLE_INFO['Villageois'];
        const myLoups  = myRole==='Loup-Garou' ? players.filter(p=>s.roles[p.id]==='Loup-Garou'&&p.id!==me.id) : [];

        if (amRevealing) {
          root.innerHTML = `
            <div class="game-header"><div class="game-title">🐺 Loups Garous</div></div>
            <div class="game-body slide-up">
              <div style="text-align:center;color:var(--muted);font-size:12px;letter-spacing:2px">📵 ÉCRAN PRIVÉ</div>
              <div class="role-reveal-card" style="--role-color:${ri.color}">
                <span class="role-emoji-lg">${ri.icon}</span>
                <div class="role-title-lg" style="color:${ri.color}">${myRole.toUpperCase()}</div>
                <div class="role-desc">${ri.desc}</div>
                ${myLoups.length>0?`
                  <div style="margin-top:16px;padding:12px;background:rgba(255,61,107,.1);border-radius:12px;border:1px solid rgba(255,61,107,.3)">
                    <div style="font-size:10px;color:#ff3d6b;letter-spacing:2px;margin-bottom:6px">🐺 TES COMPLICES</div>
                    <div style="font-weight:700">${myLoups.map(p=>`${p.avatar} ${p.name}`).join(', ')}</div>
                  </div>` : ''}
              </div>
              <button class="btn-primary" style="--g1:${g.g1};--g2:${g.g2}" onclick="loupNextReveal()">J'AI LU MON RÔLE ›</button>
            </div>
          `;
          window.loupNextReveal = () => {
            const next = s.revealIndex+1;
            const ns = next>=s.revealOrder.length
              ? {...s, phase:'day', revealIndex:next}
              : {...s, revealIndex:next};
            onStateChange(ns); render(ns);
          };
        } else {
          root.innerHTML=`
            <div class="game-header"><div class="game-title">🐺 Loups Garous</div></div>
            <div class="waiting-screen">
              <div class="waiting-emoji">${cp?.avatar}</div>
              <div class="waiting-title">${cp?.name}</div>
              <div class="waiting-sub">découvre son rôle secret…<br>Fermez les yeux !</div>
            </div>
          `;
        }

      } else if (s.phase === 'day') {
        if (nLoups >= nVillage) { Logger.info('loups', 'Victoire des loups (jour)'); const ns={...s,phase:'end',winner:'loups'}; onStateChange(ns); render(ns); return; }
        if (nLoups === 0)       { Logger.info('loups', 'Victoire du village (jour)'); const ns={...s,phase:'end',winner:'village'}; onStateChange(ns); render(ns); return; }

        root.innerHTML=`
          <div class="game-header"><div class="game-title">☀️ Phase de Jour — Manche ${s.round+1}</div></div>
          <div class="game-body slide-up">
            <div class="challenge-card" style="--card-color:#ff9500">
              <div class="challenge-type">☀️ DISCUSSION & VOTE</div>
              <div class="challenge-text">Débattez ensemble et votez pour éliminer un suspect !</div>
            </div>
            ${isHost?`
              <div class="section-label">QUI EST ÉLIMINÉ PAR LE VOTE ?</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${alivePlayers.map(p=>`
                  <button class="wolf-player-row" onclick="loupEliminate('${p.id}','day')">
                    <span style="font-size:22px">${p.avatar}</span>
                    <span style="font-weight:700;font-size:15px">${p.name}</span>
                  </button>
                `).join('')}
              </div>
              <button class="btn-secondary" onclick="loupSkipDay()">Pas d'élimination ce jour</button>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>Attendez le vote du groupe…</div>`}
            <div style="font-size:13px;color:var(--muted);text-align:center">
              🐺 ${nLoups} loup(s) — 👨‍🌾 ${nVillage} villageois
            </div>
          </div>
        `;
        if (isHost) {
          window.loupEliminate = (pid, phase) => {
            const role = s.roles[pid];
            const ri2 = LOUP_ROLE_INFO[role]||LOUP_ROLE_INFO['Villageois'];
            showToast(`${players.find(p=>p.id===pid)?.name} était ${ri2.icon} ${role} !`, 3000);
            const ns = {...s, alive:s.alive.filter(id=>id!==pid), phase:'night', round:s.round+1};
            setTimeout(()=>{ onStateChange(ns); render(ns); }, 1600);
          };
          window.loupSkipDay = () => {
            const ns = {...s, phase:'night', round:s.round+1};
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'night') {
        if (nLoups >= nVillage) { const ns={...s,phase:'end',winner:'loups'}; onStateChange(ns); render(ns); return; }
        if (nLoups === 0)       { const ns={...s,phase:'end',winner:'village'}; onStateChange(ns); render(ns); return; }

        root.innerHTML=`
          <div class="game-header"><div class="game-title">🌙 Phase de Nuit</div></div>
          <div class="game-body slide-up">
            <div class="challenge-card" style="--card-color:#7c3aed">
              <div class="challenge-type">🌙 TOUT LE MONDE FERME LES YEUX</div>
              <div class="challenge-text">Les loups-garous désignent leur victime silencieusement !</div>
            </div>
            ${isHost?`
              <div class="section-label">QUI LES LOUPS ONT-ILS ÉLIMINÉ ?</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${alivePlayers.map(p=>`
                  <button class="wolf-player-row" onclick="loupNightElim('${p.id}')">
                    <span style="font-size:22px">${p.avatar}</span>
                    <span style="font-weight:700;font-size:15px">${p.name}</span>
                  </button>
                `).join('')}
              </div>
              <button class="btn-secondary" onclick="loupSkipNight()">Personne éliminé cette nuit</button>
            ` : `<div class="guest-waiting"><div class="pulse-dot"></div>Fermez les yeux…</div>`}
          </div>
        `;
        if (isHost) {
          window.loupNightElim = (pid) => {
            const role = s.roles[pid];
            const ri2 = LOUP_ROLE_INFO[role]||LOUP_ROLE_INFO['Villageois'];
            showToast(`${players.find(p=>p.id===pid)?.name} était ${ri2.icon} ${role} !`, 3000);
            const ns = {...s, alive:s.alive.filter(id=>id!==pid), phase:'day'};
            setTimeout(()=>{ onStateChange(ns); render(ns); }, 1600);
          };
          window.loupSkipNight = () => {
            const ns = {...s, phase:'day'};
            onStateChange(ns); render(ns);
          };
        }

      } else if (s.phase === 'end') {
        const winner = s.winner;
        const isLoups = winner==='loups';
        // Give points
        let finalScores = {...s.scores};
        players.forEach(p=>{
          const isLoup = s.roles[p.id]==='Loup-Garou';
          if ((isLoups&&isLoup)||(!isLoups&&!isLoup)) finalScores[p.id]=(finalScores[p.id]||0)+5;
        });

        root.innerHTML=`
          <div class="game-header"><div class="game-title">🏁 Fin de partie</div></div>
          <div class="game-body slide-up">
            <div class="role-reveal-card" style="--role-color:${isLoups?'#ff3d6b':'#00aaff'}">
              <span class="role-emoji-lg">${isLoups?'🐺':'☀️'}</span>
              <div class="role-title-lg">${isLoups?'LES LOUPS GAGNENT !':'LE VILLAGE GAGNE !'}</div>
              <div class="role-desc">${isLoups?'Les loups-garous ont dominé le village…':'Le village a éliminé tous les loups !'}</div>
              <div style="margin-top:20px;display:flex;flex-direction:column;gap:6px">
                ${players.map(p=>{
                  const ri2=LOUP_ROLE_INFO[s.roles[p.id]]||LOUP_ROLE_INFO['Villageois'];
                  return `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,.04);border-radius:10px">
                    <span>${p.avatar}</span>
                    <span style="flex:1;font-weight:700">${p.name}</span>
                    <span style="font-size:20px">${ri2.icon}</span>
                    <span style="font-size:12px;color:var(--muted)">${s.roles[p.id]}</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
            ${isHost?`<button class="btn-primary" style="--g1:#1e3a8a;--g2:#00aaff" onclick="loupReplay()">🐺 NOUVELLE PARTIE</button>`:''}
            <button class="btn-secondary" id="loup-btn-home">🏠 Retour au lobby</button>
          </div>
        `;
        // `onclick="(${onEnd})()"` sérialise la closure et perd ses
        // variables capturées -> on l'attache en JS comme les autres boutons.
        root.querySelector('#loup-btn-home').addEventListener('click', () => { Logger.info('loups', 'Retour au lobby'); onEnd(); });
        if (isHost) window.loupReplay = () => { Logger.info('loups', 'Nouvelle partie'); const ns=GameEngines.loups.initState(players); onStateChange(ns); render(ns); };
      }

      if (!isHost) {
        _sub = DB.subscribeRoom(Session.room.id, (room)=>{ if(room.game_state) render(room.game_state); });
      }
    };

    render(state);
  }
};
