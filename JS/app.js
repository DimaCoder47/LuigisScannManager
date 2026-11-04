/* ================================= */
/*           THEME & COLORS          */
/* ================================= */
const THEME_COLORS = {
    duplicateBg: "#881337",
    zebraBg: "#1e293b",
    baseBg: "#0f172a",
};

const EXPORT_COLORS = {
    bg: "#ffffff",
    zebraBg: "#f8fafc",
    text: "#0f172a",
    border: "#e2e8f0", 
    borderDark: "#64748b" 
};

/* ================================ */
/*           DOM ELEMENTE           */
/* ================================ */
const videoEl = document.getElementById('video');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const scannerOverlay = document.getElementById('scannerOverlay');
const videoContainer = document.getElementById('videoContainer');
const manualInput = document.getElementById('manualInput');
const activeBinDisplay = document.getElementById('activeBinDisplay');
const exportViewBtn = document.getElementById('exportViewBtn');
const scanTableBody = document.getElementById('scanTableBody');
const scanCountBadge = document.getElementById('scanCountBadge');
const sendEmailBtn = document.getElementById('sendEmailBtn');
const copyClipboardBtn = document.getElementById('copyClipboardBtn');
const clearBtn = document.getElementById('clearBtn');

// Profil / Einstellungen
const settingsBtn = document.getElementById('settingsBtn');
const profileModal = document.getElementById('profileModal');
const closeProfileBtn = document.getElementById('closeProfileBtn');
const profileForm = document.getElementById('profileForm');
const profileEmailInput = document.getElementById('profileEmailInput');

/* ================================ */
/*           STATE MANAGEMENT       */
/* ================================ */
let scanRecords = JSON.parse(localStorage.getItem('putaway_scan_records')) || [];
let activeBinId = localStorage.getItem('putaway_active_bin') || null;
let userEmail = localStorage.getItem('putaway_user_email') || '';
let codeReader = null;
let isCameraActive = false;
let lastScannedCode = '';
let scanDebounceTimer = null;
let canProcessScan = false;
let toastTimeout = null;
let scannerToastTimeout = null;
let cachedAudioCtx = null;

/* ======================= */
/*         LIFECYCLE       */
/* ======================= */
function setActiveBinId(binId) {
    activeBinId = binId;
    if (activeBinDisplay) activeBinDisplay.textContent = activeBinId;
    persistData();
}

function persistData() {
    localStorage.setItem('putaway_scan_records', JSON.stringify(scanRecords));
    if (activeBinId) {
        localStorage.setItem('putaway_active_bin', activeBinId);
    } else {
        localStorage.removeItem('putaway_active_bin');
    }
}

function refreshAppState() {
    scanRecords = JSON.parse(localStorage.getItem('putaway_scan_records')) || [];
    activeBinId = localStorage.getItem('putaway_active_bin') || null;
    userEmail = localStorage.getItem('putaway_user_email') || '';

    if (activeBinDisplay) {
        activeBinDisplay.textContent = activeBinId ? activeBinId : '-- Nicht gesetzt --';
    }
    renderTable();
}

window.addEventListener('DOMContentLoaded', refreshAppState);
window.addEventListener('pageshow', refreshAppState);

/* ==================================== */
/*       PURE HELPER & VALIDATOREN      */
/* ==================================== */
// Prefix D01–D72
function isValidBinId(code) {
    const cleanCode = String(code).trim().toUpperCase();
    // Validiert D01xxxxx bis D72xxxxx (Länge: 7 Zeichen)
    return /^D(0[1-9]|[1-6]\d|7[0-2])\d{4}$/.test(cleanCode);
}

function isValidSN(code) {
    if (!code) return false;
    const cleanCode = String(code).trim();
    return cleanCode.length > 0 && cleanCode.length <= 25;
}

function getFormattedTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return {
        dateCode: `${year}${month}${day}`,
        dateDotted: `${year}.${month}.${day}`,
        timeCode: `${hours}Uhr${minutes}`
    };
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* ================================= */
/*      FEEDBACK & SIGNAL-SYSTEM     */
/* ================================= */
async function triggerHaptic(type = 'success') {
    try {
        setTimeout(async () => {
            const h = window.Capacitor?.Plugins?.Haptics;
            if (h) {
                if (type === 'error' || type === 'duplicate') {
                    await h.vibrate({ duration: 80 });
                    await new Promise(r => setTimeout(r, 80));
                    await h.vibrate({ duration: 80 });
                } else { await h.vibrate({ duration: 80 }); }
            } else if ('vibrate' in navigator) {
                if (type === 'error' || type === 'duplicate') navigator.vibrate([80, 50, 80]);
                else navigator.vibrate(80);
            }
        }, 30);
    } catch (e) {}
}

function playBeep(type = 'success') {
    try {
        if (!cachedAudioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) cachedAudioCtx = new AC();
        }
        const ctx = cachedAudioCtx;
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        const now = ctx.currentTime;

        if (type === 'error' || type === 'duplicate') {
            osc.frequency.setValueAtTime(300, now);
            g.gain.setValueAtTime(0, now);
            g.gain.setValueAtTime(0.6, now);
            g.gain.setValueAtTime(0, now + 0.10);
            g.gain.setValueAtTime(0.6, now + 0.16);
            g.gain.setValueAtTime(0, now + 0.26);
            triggerHaptic('error');
        } else {
            osc.frequency.setValueAtTime(880, now);
            g.gain.setValueAtTime(0.5, now);
            triggerHaptic('success');
        }
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + (type === 'error' ? 0.28 : 0.15));
    } catch (e) {}
}

function showToast(title, message, type = 'success') {
    const isScan = scannerOverlay && !scannerOverlay.classList.contains('hidden');
    const toastEl = isScan ? document.getElementById('scannerToast') : document.getElementById('toast');
    if (!toastEl) return;

    const tT = isScan ? document.getElementById('scannerToastTitle') : document.getElementById('toastTitle');
    const tM = isScan ? document.getElementById('scannerToastMessage') : document.getElementById('toastMessage');
    const tI = isScan ? document.getElementById('scannerToastIcon') : document.getElementById('toastIcon');

    tT.textContent = title;
    tM.textContent = message;

    if (type === 'error' || type === 'duplicate') {
        tI.innerHTML = '⚠️';
        toastEl.classList.replace('border-emerald-500', 'border-rose-500');
    } else {
        tI.innerHTML = '✅';
        toastEl.classList.replace('border-rose-500', 'border-emerald-500');
    }

    if (isScan) {
        toastEl.classList.remove('scale-0', 'opacity-0');
        toastEl.classList.add('scale-100', 'opacity-100');
        if (scannerToastTimeout) clearTimeout(scannerToastTimeout);
        scannerToastTimeout = setTimeout(() => {
            toastEl.classList.replace('scale-100', 'scale-0');
            toastEl.classList.replace('opacity-100', 'opacity-0');
        }, 2500);
    } else {
        toastEl.classList.remove('translate-y-20', 'opacity-0');
        toastEl.classList.add('translate-y-0', 'opacity-100');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.replace('translate-y-0', 'translate-y-20');
            toastEl.classList.replace('opacity-100', 'opacity-0');
        }, 3000);
    }
}

/* =================================== */
/*      Daten & Tabellen-Management    */
/* =================================== */
function processScannedCode(scannedCode) {
    if (!scannedCode) return;
    const cleanCode = String(scannedCode).trimEnd();
    
    if (isValidBinId(cleanCode)) {
        setActiveBinId(cleanCode.toUpperCase());
        showToast('Erfolg', `BIN ID gesetzt: ${cleanCode.toUpperCase()}`);
        playBeep();
        if (manualInput) manualInput.value = '';
        return;
    }
    
    if (!activeBinId) {
        playBeep('error');
        showToast('Fehler', "Bitte zuerst eine gültige BIN ID scannen!", 'error');
        return;
    }
    
    if (!isValidSN(cleanCode)) {
        playBeep('error');
        showToast('Fehler', "Ungültige Seriennummer!", 'error');
        return;
    }

    const isDuplicate = scanRecords.some(record => record.sn === cleanCode);
    const newRecord = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        binId: activeBinId,
        sn: cleanCode,
        isDuplicate: isDuplicate
    };

    scanRecords.unshift(newRecord);
    persistData();
    renderTable();

    if (isDuplicate) {
        playBeep('duplicate');
        showToast('Hinweis', `SN ${cleanCode} ist eine Dublette!`, 'error');
    } else {
        playBeep('success');
        showToast('Erfolg', `SN erfasst: ${cleanCode}`);
    }
}

function renderTable() {
    if (!scanTableBody) return;
    scanTableBody.innerHTML = '';
    scanCountBadge.textContent = `${scanRecords.length} Scans`;

    if (scanRecords.length === 0) {
        scanTableBody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-500 text-xs italic">Noch keine Scans vorhanden.</td></tr>`;
        return;
    }

    const snCounts = {};
    scanRecords.forEach(r => snCounts[r.sn] = (snCounts[r.sn] || 0) + 1);

    scanRecords.forEach((record, index) => {
        const tr = document.createElement('tr');
        const isDup = snCounts[record.sn] > 1;
        
        tr.className = isDup ? "border-b border-red-700 transition-colors" : "border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors";
        tr.style.backgroundColor = isDup ? THEME_COLORS.duplicateBg : (index % 2 === 0 ? THEME_COLORS.baseBg : THEME_COLORS.zebraBg);
        
        tr.innerHTML = `
            <td class="p-3 text-xs ${isDup ? 'text-red-200' : 'text-slate-400'}">${record.timestamp}</td>
            <td class="p-3 ${isDup ? 'text-white font-bold' : 'text-amber-400 font-bold'}">${escapeHtml(record.binId)}</td>
            <td class="p-3 font-semibold text-white">${escapeHtml(record.sn)}</td>
            <td class="p-3 text-right">
                <button onclick="deleteRecord('${record.id}')" class="text-xs text-rose-300 p-1 rounded hover:bg-rose-900/60">🗑️</button>
            </td>
        `;
        scanTableBody.appendChild(tr);
    });
}

window.deleteRecord = function(id) {
    scanRecords = scanRecords.filter(r => r.id !== id);
    persistData();
    renderTable();
    showToast('Gelöscht', 'Eintrag entfernt.', 'info');
};

/* ==================================== */
/*        Kamera & ZXING-SCANNER        */
/* ==================================== */
function startCamera() {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]);
    codeReader = new ZXing.BrowserMultiFormatReader(hints);
    const constraints = { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: "continuous" }] } };

    codeReader.decodeFromConstraints(constraints, 'video', (result, err) => {
        if (result && canProcessScan) {
            const tB = document.getElementById('targetScanBox');
            if (tB && videoEl) {
                const bR = tB.getBoundingClientRect();
                const pts = result.getResultPoints();
                const vR = videoEl.getBoundingClientRect();
                const sX = vR.width / videoEl.videoWidth;
                const sY = vR.height / videoEl.videoHeight;
                let inside = false;
                for (const p of pts) {
                    const x = vR.left + (p.getX() * sX);
                    const y = vR.top + (p.getY() * sY);
                    if (x >= bR.left && x <= bR.right && y >= bR.top && y <= bR.bottom) { inside = true; break; }
                }
                if (!inside) return;
            }
            if (result.getText() !== lastScannedCode) {
                lastScannedCode = result.getText();
                processScannedCode(lastScannedCode);
                canProcessScan = false;
                clearTimeout(scanDebounceTimer);
                scanDebounceTimer = setTimeout(() => { lastScannedCode = ''; canProcessScan = true; }, 1500);
            }
        }
    }).then(() => {
        isCameraActive = true;
        videoEl.classList.remove('hidden');
        scannerOverlay.classList.remove('hidden');
        cameraPlaceholder.classList.add('hidden');
        document.getElementById('scanButtonContainer').classList.remove('hidden');
        videoContainer.classList.add('camera-fullscreen-mode');
        document.body.classList.add('overflow-hidden');
        document.getElementById('closeFullscreenBtn').classList.remove('hidden');
        document.getElementById('toggleCameraBtn').classList.add('hidden');
    }).catch(e => showToast('Kamerafehler', 'Zugriff fehlgeschlagen.', 'error'));
}

function stopCamera() {
    if (codeReader) { codeReader.reset(); codeReader = null; }
    isCameraActive = false;
    videoEl.classList.add('hidden');
    scannerOverlay.classList.add('hidden');
    cameraPlaceholder.classList.remove('hidden');
    document.getElementById('scanButtonContainer').classList.add('hidden');
    videoContainer.classList.remove('camera-fullscreen-mode');
    document.body.classList.remove('overflow-hidden');
    document.getElementById('closeFullscreenBtn').classList.add('hidden');
    document.getElementById('toggleCameraBtn').classList.remove('hidden');
}

/* ================================= */
/*           HTML BUILDER            */
/* ================================= */
function buildExportHtml(records) {
    const todayFormatted = new Date().toLocaleDateString('de-DE');
    const sortedRecords = [...records].reverse();
    let prevBin = null;

    const rows = sortedRecords.map((r, i) => {
        const isNew = prevBin !== null && r.binId !== prevBin;
        prevBin = r.binId;
        const style = `border-top: ${isNew ? '4px solid '+EXPORT_COLORS.borderDark : '1px solid '+EXPORT_COLORS.border}; background: ${i % 2 === 0 ? EXPORT_COLORS.bg : EXPORT_COLORS.zebraBg};`;
        return `
            <tr style="${style}">
                <td style="padding:12px;font-family:monospace;font-size:14px;color:${EXPORT_COLORS.text};">
                    <b>${escapeHtml(r.binId)}</b>
                    <button onclick="cp('${escapeHtml(r.binId)}',this)" style="margin-left:12px;cursor:pointer;border:1px solid #ddd;background:#fff;border-radius:4px;padding:4px 8px;font-size:12px;">📋</button>
                </td>
                <td style="padding:12px;font-family:monospace;font-size:14px;color:${EXPORT_COLORS.text};">
                    ${escapeHtml(r.sn)}
                    <button onclick="cp('${escapeHtml(r.sn)}',this)" style="margin-left:12px;cursor:pointer;border:1px solid #ddd;background:#fff;border-radius:4px;padding:4px 8px;font-size:12px;">📋</button>
                </td>
            </tr>`;
    }).join('');

    return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Scan Export</title>
    <style>
        body{font-family:-apple-system,sans-serif;padding:20px;background:#fff;margin:0;}
        table{width:100%;border-collapse:collapse;margin-top:10px;}
        th{background:${EXPORT_COLORS.borderDark};color:white;padding:12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:1px;}
        h2{margin-top:0;color:${EXPORT_COLORS.text};font-size:18px;}
    </style>
    </head><body><h2>📦 Scan-Liste (${todayFormatted})</h2>
    <table><thead><tr><th>BIN (Platz)</th><th>Seriennummer (SN)</th></tr></thead><tbody>${rows}</tbody></table>
    <script>function cp(t,b){const o=b.innerText;if(navigator.clipboard){navigator.clipboard.writeText(t).then(()=>{b.innerText='✅';setTimeout(()=>b.innerText=o,1000);});}else{const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');document.body.removeChild(a);b.innerText='✅';setTimeout(()=>b.innerText=o,1000);}}</script></body></html>`;
}

/* ========================================== */
/*     UI-EVENT-LISTENER & INITIALISIERUNG    */
/* ========================================== */

// Profilverwaltung
function openProfileModal() { profileEmailInput.value = userEmail; profileModal.classList.remove('hidden'); }
function closeProfileModal() { profileModal.classList.add('hidden'); }
settingsBtn?.addEventListener('click', openProfileModal);
closeProfileBtn?.addEventListener('click', closeProfileModal);
profileForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    userEmail = profileEmailInput.value.trim();
    localStorage.setItem('putaway_user_email', userEmail);
    showToast('Profil gespeichert', 'E-Mail wurde aktualisiert.', 'success');
    closeProfileModal();
});

// Übersicht
function showOverview() {
    const container = document.getElementById('overviewContentContainer');
    if (container) {
        container.innerHTML = '';
        const iframe = document.createElement('iframe');
        // scrolling="no" verhindert interne Scrollbalken
        iframe.setAttribute('scrolling', 'no');
        iframe.className = 'w-full border-0 bg-white overflow-hidden';
        iframe.srcdoc = buildExportHtml(scanRecords);
        
        // Magie für die Höhe: Setzt die Iframe-Höhe exakt auf den Content
        iframe.onload = () => { 
            setTimeout(() => {
                try { 
                    const height = iframe.contentWindow.document.body.scrollHeight;
                    iframe.style.height = (height + 50) + 'px'; 
                } catch(e){ console.error("Iframe Height Error", e); }
            }, 100);
        };
        container.appendChild(iframe);
    }
    document.getElementById('mainAppView').classList.add('hidden');
    document.getElementById('overviewView').classList.remove('hidden');
    window.scrollTo(0,0);
}

exportViewBtn?.addEventListener('click', () => scanRecords.length ? showOverview() : showToast('Fehler', 'Keine Daten!', 'error'));
document.getElementById('backToAppBtn')?.addEventListener('click', () => {
    document.getElementById('overviewView').classList.add('hidden');
    document.getElementById('mainAppView').classList.remove('hidden');
});

// Buttons
document.getElementById('toggleCameraBtn')?.addEventListener('click', () => isCameraActive ? stopCamera() : startCamera());
document.getElementById('closeFullscreenBtn')?.addEventListener('click', stopCamera);
document.getElementById('captureScanBtn')?.addEventListener('click', () => {
    canProcessScan = true;
    if (lastScannedCode) processScannedCode(lastScannedCode);
    else showToast('Hinweis', 'Kein Code erkannt.', 'error');
});

manualInputForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (manualInput.value) { processScannedCode(manualInput.value); manualInput.value = ''; setTimeout(() => manualInput.focus(), 100); }
});

clearBtn?.addEventListener('click', () => {
    if (scanRecords.length && confirm('Wirklich alle Scans löschen?')) {
        scanRecords = []; activeBinId = null; persistData(); refreshAppState();
        showToast('Geleert', 'Alle Daten wurden zurückgesetzt.', 'info');
    }
});

// E-Mail & Cross-Platform Export
sendEmailBtn?.addEventListener('click', async () => {
    const t = scanRecords.length;
    if (!t) return showToast('Fehler', 'Keine Daten!', 'error');
    if (!userEmail) { showToast('Profil unvollständig', 'Bitte E-Mail hinterlegen!', 'error'); setTimeout(openProfileModal, 1000); return; }

    const { dateCode, dateDotted, timeCode } = getFormattedTimestamp();
    const fN = `PutAway_${dateCode}_${timeCode}.html`;
    const sbj = `PutAway - ${dateDotted} (${t} Scans)`;
    const bdy = `Hallo,\n\nanbei die interaktive Datei mit ${t} Scans für die Umbuchung.\n\nViele Grüße`;
    const h = buildExportHtml(scanRecords);

    if (window.Capacitor?.isNativePlatform()) {
        try {
            const { Filesystem, Directory } = window.Capacitor.Plugins;
            const { Share } = window.Capacitor.Plugins;
            const res = await Filesystem.writeFile({ path: fN, data: h, directory: Directory.Cache, encoding: 'utf8' });
            await Share.share({ title: sbj, text: bdy, url: res.uri, dialogTitle: 'Export senden via...' });
            return;
        } catch (e) { console.error(e); }
    }

    if (navigator.share && navigator.canShare) {
        const bl = new Blob([h], { type: 'text/html' });
        const fl = new File([bl], fN, { type: 'text/html' });
        if (navigator.canShare({ files: [fl] })) {
            try { await navigator.share({ files: [fl], title: sbj, text: bdy }); return; } catch(e) {}
        }
    }

    const bl = new Blob([h], { type: 'text/html;charset=utf-8' });
    const lnk = document.createElement('a');
    lnk.href = URL.createObjectURL(bl);
    lnk.download = fN;
    lnk.click();
    window.open(`mailto:${userEmail}?subject=${encodeURIComponent(sbj)}&body=${encodeURIComponent(bdy)}`, '_blank');
    showToast('Export', 'HTML geladen & E-Mail geöffnet!', 'success');
});

// Clipboard
copyClipboardBtn?.addEventListener('click', () => {
    if (!scanRecords.length) return showToast('Fehler', 'Keine Daten!', 'error');
    let t = 'BIN\tSeriennummer\n';
    [...scanRecords].reverse().forEach(r => t += `${r.binId}\t${r.sn}\n`);
    navigator.clipboard.writeText(t).then(() => showToast('Kopiert!', 'Daten in Zwischenablage.', 'success'));
});
