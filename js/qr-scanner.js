// ══════════════════════════════════════
// qr-scanner.js — Scan QR via caméra
// - Android/Chrome : BarcodeDetector + getUserMedia (temps réel)
// - iOS Safari     : input file capture + jsQR (photo)
// ══════════════════════════════════════

const QRScanner = (() => {
  let _stream = null;
  let _rafId  = null;

  // ── Chargement paresseux de jsQR (iOS uniquement) ──
  function _loadJsQR() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Impossible de charger jsQR'));
      document.head.appendChild(s);
    });
  }

  // ── Extraction du code depuis une valeur brute ──
  function _extractCode(raw) {
    let code = raw.trim();
    try {
      const u = new URL(raw);
      const c = u.searchParams.get('code');
      if (c) code = c.trim();
    } catch (_) {}
    return code.toUpperCase();
  }

  // ── Redirection immédiate vers nom + avatar ──
  function _onCode(code) {
    if (code.length !== 4) { showToast('QR invalide, réessaie'); return; }
    const input = document.getElementById('join-code-input');
    if (input) input.value = code;
    _pendingFlow = 'join:' + code;
    document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
    document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
    showScreen('name');
  }

  // ════════════════════════════════════════
  // MODE A — BarcodeDetector (Android/Chrome)
  // ════════════════════════════════════════
  function _stop() {
    if (_rafId)  { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  function _closModal() {
    _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
  }

  async function _openCamera() {
    const modal  = document.getElementById('qr-scanner-modal');
    const video  = document.getElementById('qr-video');
    const hint   = document.getElementById('qr-scanner-hint');

    modal.classList.remove('hidden');
    hint.textContent = 'Pointe sur le QR code du host';

    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
      video.srcObject = _stream;
      await video.play();

      const scan = async () => {
        if (!_stream) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const code = _extractCode(codes[0].rawValue);
            _closModal();
            _onCode(code);
            return;
          }
        } catch (_) {}
        _rafId = requestAnimationFrame(scan);
      };
      _rafId = requestAnimationFrame(scan);

    } catch (e) {
      hint.textContent = '⚠️ Impossible d\'accéder à la caméra.';
    }
  }

  // ════════════════════════════════════════
  // MODE B — Input file + jsQR (iOS Safari)
  // ════════════════════════════════════════
  async function _openFilePicker() {
    try {
      await _loadJsQR();
    } catch (e) {
      showToast('Impossible de charger le décodeur QR');
      return;
    }

    const input = document.createElement('input');
    input.type    = 'file';
    input.accept  = 'image/*';
    input.capture = 'environment';

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;

      try {
        const img    = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx    = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height);
        const result = jsQR(pixels.data, img.width, img.height);

        if (result) {
          const code = _extractCode(result.data);
          _onCode(code);
        } else {
          showToast('QR non détecté — réessaie en te rapprochant');
        }
      } catch (e) {
        showToast('Erreur lecture image');
      }
    };

    input.click();
  }

  // ════════════════════════════════════════
  // ENTRÉE PUBLIQUE
  // ════════════════════════════════════════
  function open() {
    if ('BarcodeDetector' in window) {
      _openCamera();
    } else {
      // iOS Safari et navigateurs sans BarcodeDetector
      _openFilePicker();
    }
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick      = () => open();
    document.getElementById('btn-close-scanner').onclick = () => _closModal();
  }

  return { init, open };
})();
