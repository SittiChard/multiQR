/*
 * Multi-QR Scanner - Web version
 * ---------------------------------
 * Mirrors the behavior agreed on for the Python V4 plan, but for
 * Android phones via the browser using the native BarcodeDetector API
 * (hardware-accelerated, detects multiple QR codes per frame natively
 * -- no external library needed on supported browsers).
 *
 * Status colors:
 *   RED   = QR code visible right now, not yet recorded
 *   GREEN = QR code visible right now, already recorded (matched by
 *           decoded content, not by screen position -- so it re-lights
 *           green automatically whenever the camera comes back to it)
 *
 * Controls (on-screen buttons, since phones have no keyboard):
 *   Read   -> record whatever QR code(s) are detected at this instant
 *   Export -> toggle an on-screen panel listing everything recorded
 *   Clear  -> reset the session
 */

const video = document.getElementById('camera');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

const recordedNumEl = document.getElementById('recordedNum');
const statusMsgEl = document.getElementById('statusMsg');

const btnRead = document.getElementById('btnRead');
const btnExport = document.getElementById('btnExport');
const btnClear = document.getElementById('btnClear');

const exportPanel = document.getElementById('exportPanel');
const exportList = document.getElementById('exportList');
const exportEmpty = document.getElementById('exportEmpty');
const exportClose = document.getElementById('exportClose');

const permissionGate = document.getElementById('permissionGate');
const gateText = document.getElementById('gateText');
const btnStart = document.getElementById('btnStart');

// session state: Map<decodedText, { order: number }>
const recorded = new Map();
let nextOrder = 0;

// latest detection results from the camera, refreshed continuously
let lastDetections = []; // [{ data, box: {x,y,w,h} }]

const DETECT_INTERVAL_MS = 150; // throttle detection to save battery/CPU
let detecting = false;
let barcodeDetector = null;

function supportsBarcodeDetector() {
  return 'BarcodeDetector' in window;
}

async function init() {
  if (!supportsBarcodeDetector()) {
    gateText.textContent =
      'เบราว์เซอร์นี้ไม่รองรับการอ่าน QR แบบในตัว กรุณาเปิดด้วย Chrome บน Android แทน';
    btnStart.disabled = true;
    btnStart.style.opacity = 0.5;
    return;
  }

  try {
    barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (err) {
    gateText.textContent = 'ไม่สามารถเริ่มตัวอ่าน QR ได้: ' + err.message;
    return;
  }

  btnStart.addEventListener('click', startCamera);
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    // size the overlay canvas to match the video's native resolution
    // so detection coordinates (in video pixel space) map 1:1 -- the
    // CSS on both #camera and #overlay scales them identically.
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    permissionGate.classList.add('hidden');
    requestAnimationFrame(drawLoop);
    setInterval(detectLoop, DETECT_INTERVAL_MS);
  } catch (err) {
    gateText.textContent =
      'เปิดกล้องไม่สำเร็จ (' + err.message + ') กรุณาอนุญาตสิทธิ์กล้องแล้วลองใหม่';
  }
}

async function detectLoop() {
  if (detecting || video.readyState < 2) return;
  detecting = true;
  try {
    const barcodes = await barcodeDetector.detect(video);
    lastDetections = barcodes.map((b) => ({
      data: b.rawValue,
      box: {
        x: b.boundingBox.x,
        y: b.boundingBox.y,
        w: b.boundingBox.width,
        h: b.boundingBox.height,
      },
    }));
    statusMsgEl.textContent = '';
  } catch (err) {
    statusMsgEl.textContent = 'ตรวจจับผิดพลาด: ' + err.message;
  }
  detecting = false;
}

function drawLoop() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  for (const det of lastDetections) {
    const isRead = recorded.has(det.data);
    const color = isRead ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)';
    const { x, y, w, h } = det.box;

    ctx.lineWidth = Math.max(3, overlay.width * 0.004);
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    const label = isRead ? '#' + recorded.get(det.data).order : 'NEW';
    ctx.font = `${Math.max(18, overlay.width * 0.02)}px -apple-system, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(label, x, Math.max(0, y - 8));
  }

  requestAnimationFrame(drawLoop);
}

function onRead() {
  let newlyRecorded = 0;
  for (const det of lastDetections) {
    if (!recorded.has(det.data)) {
      nextOrder += 1;
      recorded.set(det.data, { order: nextOrder });
      newlyRecorded += 1;
    }
  }
  recordedNumEl.textContent = String(recorded.size);

  if (newlyRecorded === 0) {
    statusMsgEl.textContent = lastDetections.length
      ? 'ไม่มี QR ใหม่ (บันทึกไปแล้วทั้งหมด)'
      : 'ไม่พบ QR ในภาพขณะนี้';
  } else {
    statusMsgEl.textContent = `บันทึกเพิ่ม ${newlyRecorded} รายการ`;
  }
}

function onClear() {
  recorded.clear();
  nextOrder = 0;
  recordedNumEl.textContent = '0';
  statusMsgEl.textContent = 'ล้างข้อมูลแล้ว';
  renderExportPanel();
}

function renderExportPanel() {
  const rows = [...recorded.entries()].sort((a, b) => a[1].order - b[1].order);
  exportList.innerHTML = '';
  if (rows.length === 0) {
    exportEmpty.classList.remove('hidden');
    return;
  }
  exportEmpty.classList.add('hidden');
  for (const [data, info] of rows) {
    const row = document.createElement('div');
    row.className = 'export-row';
    row.innerHTML = `<span class="idx">${info.order}</span><span class="data"></span>`;
    row.querySelector('.data').textContent = data; // textContent avoids HTML injection
    exportList.appendChild(row);
  }
}

function toggleExport() {
  const isVisible = exportPanel.classList.toggle('visible');
  btnExport.classList.toggle('active', isVisible);
  if (isVisible) renderExportPanel();
}

btnRead.addEventListener('click', onRead);
btnExport.addEventListener('click', toggleExport);
btnClear.addEventListener('click', onClear);
exportClose.addEventListener('click', toggleExport);

init();
