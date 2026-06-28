// ══════════════════════════════════════
// db.js — Supabase realtime layer
// ══════════════════════════════════════

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Helpers ────────────────────────────────────────────────

function _genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

// ── Rooms ──────────────────────────────────────────────────

const DB = {

  /** Create a new lobby, returns room object */
  async createRoom(hostPlayer) {
    const code = _genCode();
    Logger.debug('db', 'createRoom →', { code, hostId: hostPlayer.id });
    const { data, error } = await _sb
      .from('rooms')
      .insert({
        code,
        host_id: hostPlayer.id,
        status: 'waiting',   // waiting | playing | finished
        game: null,
        game_state: null,
      })
      .select().single();
    if (error) { Logger.error('db', 'createRoom échec', error.message); throw error; }
    Logger.info('db', 'Salle créée', code, data.id);
    return data;
  },

  /** Get room by id (used to restore a session after reload). Returns null if gone. */
  async getRoomById(roomId) {
    Logger.debug('db', 'getRoomById →', roomId);
    const { data, error } = await _sb
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .maybeSingle();
    if (error) { Logger.error('db', 'getRoomById échec', roomId, error.message); throw error; }
    return data;
  },

  /** Get room by code */
  async getRoom(code) {
    Logger.debug('db', 'getRoom →', code);
    const { data, error } = await _sb
      .from('rooms')
      .select('*')
      .eq('code', code.toUpperCase())
      .single();
    if (error) { Logger.warn('db', 'getRoom introuvable', code, error.message); throw error; }
    return data;
  },

  /** Update room fields (host only) */
  async updateRoom(roomId, fields) {
    Logger.debug('db', 'updateRoom →', roomId, fields);
    const { error } = await _sb.from('rooms').update(fields).eq('id', roomId);
    if (error) { Logger.error('db', 'updateRoom échec', roomId, error.message); throw error; }
  },

  /** Delete room (cleanup) */
  async deleteRoom(roomId) {
    Logger.info('db', 'Suppression de la salle', roomId);
    await _sb.from('players').delete().eq('room_id', roomId);
    await _sb.from('rooms').delete().eq('id', roomId);
  },

  // ── Players ──────────────────────────────────────────────

  /** Insert player into room */
  async joinRoom(roomId, player) {
    Logger.debug('db', 'joinRoom →', roomId, player.name);
    const { data, error } = await _sb
      .from('players')
      .insert({ room_id: roomId, ...player })
      .select().single();
    if (error) { Logger.error('db', 'joinRoom échec', error.message); throw error; }
    Logger.info('db', 'Joueur rejoint', player.name, '→', roomId);
    return data;
  },

  /** Get a single player by id (used to restore a session after reload) */
  async getPlayer(playerId) {
    Logger.debug('db', 'getPlayer →', playerId);
    const { data, error } = await _sb
      .from('players')
      .select('*')
      .eq('id', playerId)
      .maybeSingle();
    if (error) { Logger.error('db', 'getPlayer échec', playerId, error.message); throw error; }
    return data; // null si le joueur n'existe plus (salle supprimée, kické, etc.)
  },

  /** Get all players in room */
  async getPlayers(roomId) {
    const { data, error } = await _sb
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    if (error) { Logger.error('db', 'getPlayers échec', roomId, error.message); throw error; }
    Logger.debug('db', 'getPlayers', roomId, '→', data.length, 'joueur(s)');
    return data;
  },

  /** Remove player */
  async leaveRoom(playerId) {
    Logger.info('db', 'leaveRoom', playerId);
    await _sb.from('players').delete().eq('id', playerId);
  },

  /** Update single player (score, role, etc.) */
  async updatePlayer(playerId, fields) {
    Logger.debug('db', 'updatePlayer →', playerId, fields);
    const { error } = await _sb.from('players').update(fields).eq('id', playerId);
    if (error) { Logger.error('db', 'updatePlayer échec', playerId, error.message); throw error; }
  },

  // ── Realtime subscriptions ────────────────────────────────

  /**
   * Subscribe to room changes (status, game_state).
   * `tag` distingue le canal du lobby de celui de la partie en cours :
   * lobby.js désabonne le canal du lobby (`Session.roomSub`, tag par
   * défaut) puis recrée immédiatement un canal pour la partie
   * (`Session.gameSub`) au même roomId. `removeChannel()` est
   * asynchrone côté supabase-js — si les deux canaux portaient le même
   * nom, le second pourrait réutiliser l'ancien objet pas encore
   * vraiment retiré côté serveur, retardant de plusieurs secondes la
   * réception des mises à jour (c'est ce qui causait le décalage du
   * chrono entre le meneur et les autres joueurs).
   */
  subscribeRoom(roomId, callback, tag = 'lobby') {
    Logger.debug('db', 'subscribeRoom', roomId, tag);
    return _sb.channel(`room:${roomId}:${tag}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rooms',
        filter: `id=eq.${roomId}`
      }, payload => { Logger.debug('db', 'room update reçu', roomId, tag); callback(payload.new); })
      .subscribe();
  },

  /** Subscribe to players list changes */
  subscribePlayers(roomId, callback) {
    Logger.debug('db', 'subscribePlayers', roomId);
    return _sb.channel(`players:${roomId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'players',
        filter: `room_id=eq.${roomId}`
      }, () => DB.getPlayers(roomId).then(callback))
      .subscribe();
  },

  /** Unsubscribe channel */
  unsub(channel) {
    if (channel) { Logger.debug('db', 'unsub', channel.topic); _sb.removeChannel(channel); }
  },

  // ── Contenu des jeux (questions, réponses, rôles, règles…) ──
  // Lecture seule, en lecture publique (cf. supabase_schema.sql section 7).
  // Chargé une fois au boot et mis en cache dans GameContent (app.js).

  async getCameleonRoles() {
    const { data, error } = await _sb.from('cameleon_roles').select('role, hint');
    if (error) { Logger.error('db', 'getCameleonRoles échec', error.message); throw error; }
    return data.map(r => ({ role: r.role, hint: r.hint }));
  },

  async getCameleonQuestions() {
    const { data, error } = await _sb.from('cameleon_questions').select('text');
    if (error) { Logger.error('db', 'getCameleonQuestions échec', error.message); throw error; }
    return data.map(r => r.text);
  },

  async getVeriteCards() {
    const { data, error } = await _sb.from('verite_cards').select('type, text');
    if (error) { Logger.error('db', 'getVeriteCards échec', error.message); throw error; }
    return {
      verite: data.filter(c => c.type === 'verite').map(c => c.text),
      defi: data.filter(c => c.type === 'defi').map(c => c.text),
    };
  },

  async getMissionList() {
    const { data, error } = await _sb.from('mission_list').select('text');
    if (error) { Logger.error('db', 'getMissionList échec', error.message); throw error; }
    return data.map(r => r.text);
  },

  async getFamilleCategories() {
    const { data, error } = await _sb.from('famille_categories').select('id, name, icon');
    if (error) { Logger.error('db', 'getFamilleCategories échec', error.message); throw error; }
    return data;
  },

  async getFamilleQuestions() {
    const { data, error } = await _sb.from('famille_questions').select('category, question, answers');
    if (error) { Logger.error('db', 'getFamilleQuestions échec', error.message); throw error; }
    return data.map(r => ({ cat: r.category, q: r.question, answers: r.answers }));
  },

  async getChangerRules() {
    const { data, error } = await _sb.from('changer_rules').select('icon, name, rule, action');
    if (error) { Logger.error('db', 'getChangerRules échec', error.message); throw error; }
    return data;
  },

  async getLoupsRoles() {
    const { data, error } = await _sb.from('loups_roles').select('id, icon, color, description, team');
    if (error) { Logger.error('db', 'getLoupsRoles échec', error.message); throw error; }
    return Object.fromEntries(data.map(r => [r.id, { icon: r.icon, color: r.color, desc: r.description, team: r.team }]));
  },
};
