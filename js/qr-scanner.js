// ══════════════════════════════════════
// qr-scanner.js — Scan QR via caméra (temps réel)
// - BarcodeDetector si dispo (Android Chrome) : natif, rapide
// - Sinon (iOS Safari) : getUserMedia + jsQR frame-by-frame
// ══════════════════════════════════════

const QRScanner = (() => {
  let _stream  = null;
  let _rafId   = null;
  let _canvas  = null;
  let _ctx     = null;

  // ── Chargement paresseux de jsQR ──
  function _loadJsQR() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) { resolve(); return; }
      const s = document.createElement('script');
      s.src     = 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('jsQR indisponible'));
      document.head.appendChild(s);
    });
  }

  // ── Extraction du code 4 lettres depuis une valeur brute ──
  function _extractCode(raw) {
    let code = raw.trim();
    try {
      const u = new URL(raw);
      const c = u.searchParams.get('code');
      if (c) code = c.trim();
    } catch (_) {}
    return code.toUpperCase();
  }

  // ── Aller directement sur l'écran nom + avatar ──
  function _onCode(code) {
    if (code.length !== 4) { showToast('QR invalide, réessaie'); return; }
    const input = document.getElementById('join-code-input');
    if (input) input.value = code;
    _pendingFlow = 'join:' + code;
    document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
    document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
    showScreen('name');
  }

  // ── Arrêt propre de la caméra ──
  function _stop() {
    if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  function _closeModal() {
    _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
  }

  // ── Boucle de scan avec BarcodeDetector ──
  function _loopNative(video, detector) {
    _rafId = requestAnimationFrame(async () => {
      if (!_stream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const code = _extractCode(codes[0].rawValue);
          _closeModal();
          _onCode(code);
          return;
        }
      } catch (_) {}
      _loopNative(video, detector);
    });
  }

  // ── Boucle de scan avec jsQR (canvas frame-by-frame) ──
  function _loopJsQR(video) {
    _rafId = requestAnimationFrame(() => {
      if (!_stream || video.readyState < video.HAVE_ENOUGH_DATA) {
        _loopJsQR(video);
        return;
      }
      _canvas.width  = video.videoWidth;
      _canvas.height = video.videoHeight;
      _ctx.drawImage(video, 0, 0);
      const pixels = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height, {
        inversionAttempts: 'dontInvert',
      });
      if (result) {
        const code = _extractCode(result.data);
        _closeModal();
        _onCode(code);
        return;
      }
      _loopJsQR(video);
    });
  }

  // ── Ouverture du scanner ──
  async function open() {
    const modal = document.getElementById('qr-scanner-modal');
    const video = document.getElementById('qr-video');
    const hint  = document.getElementById('qr-scanner-hint');

    modal.classList.remove('hidden');
    hint.textContent = 'Pointe sur le QR code du host';

    // Préparer le canvas hors-écran pour jsQR
    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _ctx    = _canvas.getContext('2d');
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
      video.srcObject = _stream;
      await video.play();

      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        _loopNative(video, detector);
      } else {
        await _loadJsQR();
        _loopJsQR(video);
      }
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
