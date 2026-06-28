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

  /** Subscribe to room changes (status, game_state) */
  subscribeRoom(roomId, callback) {
    Logger.debug('db', 'subscribeRoom', roomId);
    return _sb.channel(`room:${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rooms',
        filter: `id=eq.${roomId}`
      }, payload => { Logger.debug('db', 'room update reçu', roomId); callback(payload.new); })
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
};
