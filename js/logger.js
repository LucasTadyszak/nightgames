// ══════════════════════════════════════
// logger.js — Niveaux : debug < info < warn < error
// ══════════════════════════════════════
// Doit être chargé en premier (avant tout autre script).

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const Logger = {
  // Change à 'debug' pendant le dev, 'info' ou 'warn' en prod
  level: 'debug',

  _shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  },

  _fmt(level, scope, args) {
    const time = new Date().toISOString().split('T')[1].replace('Z', '');
    return [`[${time}] [${level.toUpperCase()}] [${scope}]`, ...args];
  },

  debug(scope, ...args) {
    if (this._shouldLog('debug')) console.debug(...this._fmt('debug', scope, args));
  },
  info(scope, ...args) {
    if (this._shouldLog('info')) console.info(...this._fmt('info', scope, args));
  },
  warn(scope, ...args) {
    if (this._shouldLog('warn')) console.warn(...this._fmt('warn', scope, args));
  },
  error(scope, ...args) {
    if (this._shouldLog('error')) console.error(...this._fmt('error', scope, args));
  },
};
