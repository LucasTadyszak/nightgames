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
    if (error) throw error;
    return data;
  },

  /** Get room by code */
  async getRoom(code) {
    const { data, error } = await _sb
      .from('rooms')
      .select('*')
      .eq('code', code.toUpperCase())
      .single();
    if (error) throw error;
    return data;
  },

  /** Update room fields (host only) */
  async updateRoom(roomId, fields) {
    const { error } = await _sb.from('rooms').update(fields).eq('id', roomId);
    if (error) throw error;
  },

  /** Delete room (cleanup) */
  async deleteRoom(roomId) {
    await _sb.from('players').delete().eq('room_id', roomId);
    await _sb.from('rooms').delete().eq('id', roomId);
  },

  // ── Players ──────────────────────────────────────────────

  /** Insert player into room */
  async joinRoom(roomId, player) {
    const { data, error } = await _sb
      .from('players')
      .insert({ room_id: roomId, ...player })
      .select().single();
    if (error) throw error;
    return data;
  },

  /** Get all players in room */
  async getPlayers(roomId) {
    const { data, error } = await _sb
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  /** Remove player */
  async leaveRoom(playerId) {
    await _sb.from('players').delete().eq('id', playerId);
  },

  /** Update single player (score, role, etc.) */
  async updatePlayer(playerId, fields) {
    const { error } = await _sb.from('players').update(fields).eq('id', playerId);
    if (error) throw error;
  },

  // ── Realtime subscriptions ────────────────────────────────

  /** Subscribe to room changes (status, game_state) */
  subscribeRoom(roomId, callback) {
    return _sb.channel(`room:${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rooms',
        filter: `id=eq.${roomId}`
      }, payload => callback(payload.new))
      .subscribe();
  },

  /** Subscribe to players list changes */
  subscribePlayers(roomId, callback) {
    return _sb.channel(`players:${roomId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'players',
        filter: `room_id=eq.${roomId}`
      }, () => DB.getPlayers(roomId).then(callback))
      .subscribe();
  },

  /** Unsubscribe channel */
  unsub(channel) {
    if (channel) _sb.removeChannel(channel);
  },
};
