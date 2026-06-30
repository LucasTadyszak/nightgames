// ══════════════════════════════════════
// qr-scanner.js — html5-qrcode (iOS + Android)
// ══════════════════════════════════════

const QRScanner = (() => {
  let _scanner = null;

  function _loadLib() {
    return new Promise((resolve, reject) => {
      if (window.Html5Qrcode) { resolve(); return; }
      const s = document.createElement('script');
      s.src     = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Lib QR indisponible'));
      document.head.appendChild(s);
    });
  }

  function _extractCode(raw) {
    let code = raw.trim();
    try {
      const u = new URL(raw);
      const c = u.searchParams.get('code');
      if (c) code = c.trim();
    } catch (_) {}
    return code.toUpperCase();
  }

  function _onCode(code) {
    if (code.length !== 4) { showToast('QR invalide, réessaie'); return; }
    const input = document.getElementById('join-code-input');
    if (input) input.value = code;
    _pendingFlow = 'join:' + code;
    document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
    document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
    showScreen('name');
  }

  async function _stop() {
    if (_scanner) {
      try { await _scanner.stop(); } catch (_) {}
      _scanner.clear();
      _scanner = null;
    }
  }

  async function _closeModal() {
    await _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
  }

  async function open() {
    const modal = document.getElementById('qr-scanner-modal');
    const hint  = document.getElementById('qr-scanner-hint');

    modal.classList.remove('hidden');
    hint.textContent = 'Chargement de la caméra…';

    try {
      await _loadLib();
    } catch (e) {
      hint.textContent = '⚠️ Impossible de charger le scanner.';
      return;
    }

    try {
      _scanner = new Html5Qrcode('qr-reader');
      await _scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        async (decodedText) => {
          const code = _extractCode(decodedText);
          await _closeModal();
          _onCode(code);
        },
        () => {} // erreurs par frame ignorées
      );
      hint.textContent = 'Pointe sur le QR code du host';
    } catch (e) {
      hint.textContent = '⚠️ Accès caméra refusé — autorise-le dans les réglages.';
    }
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick       = () => open();
    document.getElementById('btn-close-scanner').onclick = () => _closeModal();
  }

  return { init, open };
})();
