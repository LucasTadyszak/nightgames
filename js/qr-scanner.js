// ══════════════════════════════════════
// qr-scanner.js — Scan QR via caméra
// Utilise BarcodeDetector (API native, sans lib externe).
// ══════════════════════════════════════

const QRScanner = (() => {
  let _stream   = null;
  let _rafId    = null;
  let _detector = null;

  function _stop() {
    if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  async function open() {
    const modal   = document.getElementById('qr-scanner-modal');
    const video   = document.getElementById('qr-video');
    const hint    = document.getElementById('qr-scanner-hint');

    if (!('BarcodeDetector' in window)) {
      hint.textContent = '⚠️ Scanner non supporté sur ce navigateur. Utilise l\'appareil photo natif.';
      modal.classList.remove('hidden');
      return;
    }

    modal.classList.remove('hidden');
    hint.textContent = 'Pointe sur le QR code du host';

    try {
      _detector = new BarcodeDetector({ formats: ['qr_code'] });
      _stream   = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      video.srcObject = _stream;
      await video.play();
      _scanLoop(video, hint);
    } catch (e) {
      hint.textContent = '⚠️ Impossible d\'accéder à la caméra.';
    }
  }

  function _scanLoop(video, hint) {
    _rafId = requestAnimationFrame(async () => {
      if (!_stream) return;
      try {
        const codes = await _detector.detect(video);
        if (codes.length) {
          const raw = codes[0].rawValue;
          // Extraire le code depuis l'URL (?code=XXXX) ou prendre tel quel
          let code = raw;
          try {
            const u = new URL(raw);
            const c = u.searchParams.get('code');
            if (c) code = c;
          } catch (_) {}

          code = code.trim().toUpperCase();
          if (code.length === 4) {
            _stop();
            document.getElementById('qr-scanner-modal').classList.add('hidden');
            _onCode(code);
            return;
          }
        }
      } catch (_) {}
      _scanLoop(video, hint);
    });
  }

  function close() {
    _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
  }

  function _onCode(code) {
    const input = document.getElementById('join-code-input');
    if (input) input.value = code;
    // Aller directement sur l'écran nom + avatar
    _pendingFlow = 'join:' + code;
    document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
    document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
    showScreen('name');
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick     = () => open();
    document.getElementById('btn-close-scanner').onclick = () => close();
  }

  return { init, open, close };
})();
