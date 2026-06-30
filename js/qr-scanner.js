// ══════════════════════════════════════
// qr-scanner.js — getUserMedia + jsQR
// ══════════════════════════════════════

const QRScanner = (() => {
  let _stream   = null;
  let _timer    = null;
  let _canvas   = null;
  let _ctx      = null;

  function _loadJsQR() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) { resolve(); return; }
      const s = document.createElement('script');
      s.src     = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function _stop() {
    clearInterval(_timer); _timer = null;
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  function _closeModal() {
    _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
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

  function _onCode(raw) {
    const code = _extractCode(raw);
    if (code.length !== 4) { showToast('QR invalide, réessaie'); return; }
    const input = document.getElementById('join-code-input');
    if (input) input.value = code;
    _pendingFlow = 'join:' + code;
    document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
    document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
    showScreen('name');
  }

  async function open() {
    const modal = document.getElementById('qr-scanner-modal');
    const video = document.getElementById('qr-video');
    const hint  = document.getElementById('qr-scanner-hint');

    modal.classList.remove('hidden');
    hint.textContent = 'Chargement…';

    try { await _loadJsQR(); } catch (e) {
      hint.textContent = '⚠️ Scanner indisponible, utilise le code à la place.';
      return;
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (e) {
      hint.textContent = '⚠️ Accès caméra refusé — autorise-le dans les réglages iPhone.';
      return;
    }

    video.srcObject = _stream;
    video.play();

    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _ctx    = _canvas.getContext('2d', { willReadFrequently: true });
    }

    hint.textContent = 'Pointe sur le QR code du host';

    _timer = setInterval(() => {
      if (video.readyState < video.HAVE_ENOUGH_DATA || !video.videoWidth) return;

      _canvas.width  = video.videoWidth;
      _canvas.height = video.videoHeight;
      _ctx.drawImage(video, 0, 0);

      const pixels = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height, {
        inversionAttempts: 'dontInvert',
      });

      if (result) {
        _stop();
        document.getElementById('qr-scanner-modal').classList.add('hidden');
        _onCode(result.data);
      }
    }, 150);
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick       = () => open();
    document.getElementById('btn-close-scanner').onclick = () => _closeModal();
  }

  return { init, open };
})();
