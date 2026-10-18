// 1. Theme für die dunkle Web-App (UI)
const THEME_COLORS = {
    duplicateBg: "#881337", // Kräftiges Karmesinrot
    zebraBg: "#1e293b", // Slate-800 für Zebra
    baseBg: "#0f172a", // Slate-900 als Basis
};

// 2. Theme speziell für den hellen Export / E-Mail-Druck (Export HTML)
const EXPORT_COLORS = {
    bg: "#ffffff", // Reines Weiß für Container & Standard-Zeilen
    zebraBg: "#f8fafc", // Ganz zartes Hellgrau (Slate-50) für das Export-Zebra
    text: "#0f172a", // Einziger Text-Ton für maximale Klarheit
    border: "#e2e8f0", // Einheitliche, feine Linie für Ränder & th
    borderDark: "#64748b" // Kräftige Linie beim Lagerplatzwechsel
};

// Beispiel für deine zukünftigen Event-Listener (ohne störende Alerts):
document.addEventListener('DOMContentLoaded', () => {
    // Hier kommen deine Button-Listener rein
});

/* ================================ */
/*           DOM ELEMENTE           */
/* ================================ */
const videoEl = document.getElementById('video');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const scannerOverlay = document.getElementById('scannerOverlay');
const videoContainer = document.getElementById('videoContainer');
const manualInput = document.getElementById('manualInput');
const activeBinDisplay = document.getElementById('activeBinDisplay');
const scanModeBadge = document.getElementById('scanModeBadge');
const exportViewBtn = document.getElementById('exportViewBtn');
const backToScannerBtn = document.getElementById('backToScannerBtn');
const scanTableBody = document.getElementById('scanTableBody');
const scanCountBadge = document.getElementById('scanCountBadge');
const sendEmailBtn = document.getElementById('sendEmailBtn');
const copyClipboardBtn = document.getElementById('copyClipboardBtn');

/* ================================ */
/*           STATE MANAGEMENT       */
/* ================================ */
let scanRecords = JSON.parse(localStorage.getItem('putaway_scan_records')) || [];
let activeBinId = localStorage.getItem('putaway_active_bin') || null;
let scanMode = activeBinId ? 'SN' : 'BIN';
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
// scanRecords, activeBinId, persistData(), refreshAppState() sowie die DOMContentLoaded- und pageshow-Listener.

// Setzt die aktive BIN ID und wechselt den Modus
function setActiveBinId(binId) {
    activeBinId = binId;
    if (activeBinDisplay) activeBinDisplay.textContent = activeBinId;
    persistData();
}

// Persistence Helper
function persistData() {
    localStorage.setItem('putaway_scan_records', JSON.stringify(scanRecords));
    if (activeBinId) {
        localStorage.setItem('putaway_active_bin', activeBinId);
    } else {
        localStorage.removeItem('putaway_active_bin');
    }
}

// Lädt den Speicherstand neu und zeichnet die Ansicht
function refreshAppState() {
    scanRecords = JSON.parse(localStorage.getItem('putaway_scan_records')) || [];
    activeBinId = localStorage.getItem('putaway_active_bin') || null;

    if (activeBinDisplay) {
        activeBinDisplay.textContent = activeBinId ? activeBinId : '-- Nicht gesetzt --';
    }
    renderTable();
}

// 1. Beim ersten Laden der Seite ausführen
window.addEventListener('DOMContentLoaded', () => {
    refreshAppState();
});

// 2. WICHTIG: Wenn der Nutzer aus der E-Mail-App / aus einem anderen Tab zurückkehrt
window.addEventListener('pageshow', () => {
    refreshAppState();
});

/* ==================================== */
/*       PURE HELPER & VALIDATOREN      */
/* ==================================== */
// isValidBinId, isValidSN, getFormattedTimestamp, escapeHtml.

// 1. Prüft gültige BIN ID (Palette oder Regal)
function isValidBinId(code) {
    const cleanCode = String(code).trim().toUpperCase();

    // Paletten-Schema (7 Zeichen): D6 + 5 Ziffern (z. B. D610101)
    const palletRegex = /^D6\d{5}$/;

    // Regal-Schema (7 Zeichen): D0 + 5 Ziffern (z. B. D010101)
    const shelfRegex = /^D0\d{5}$/;

    return palletRegex.test(cleanCode) || shelfRegex.test(cleanCode);
}

// 2. HELPER: Prüft, ob eine Seriennummer gültig ist (1 bis 25 Zeichen, Sonderzeichen erlaubt)
function isValidSN(code) {
    if (!code) return false;
    const cleanCode = String(code).trim();
    return cleanCode.length > 0 && cleanCode.length <= 25;
}

// --- Zentraler Datum und Zeit Helfer ---
function getFormattedTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return {
        dateCode: `${year}${month}${day}`,// z. B. "20261009"
        dateDotted: `${year}.${month}.${day}`,// z. B. "2026.10.09"
        timeCode: `${hours}Uhr${minutes}`// z. B. "18Uhr54"
    };
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ================================= */
/*      FEEDBACK & SIGNAL-SYSTEM     */
/* ================================= */
// triggerHaptic, playBeep, showToast

async function triggerHaptic(type = 'success') {
    try {
        // Kleine Verzögerung, damit sich Audio und Haptik nicht auf dem Main-Thread blockieren
        setTimeout(async () => {
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
                const Haptics = window.Capacitor.Plugins.Haptics;

                if (type === 'error' || type === 'duplicate') {
                    // Doppelter Impuls für Fehler/Duplikat (Dauer in ms)
                    await Haptics.vibrate({ duration: 80 });
                    await new Promise(resolve => setTimeout(resolve, 80));
                    await Haptics.vibrate({ duration: 80 });
                } else {
                    // Einfacher kurzer Impuls bei Erfolg
                    await Haptics.vibrate({ duration: 80 });
                }
            } else if ('vibrate' in navigator) {
                // Fallback für Browser
                if (type === 'error' || type === 'duplicate') {
                    navigator.vibrate([80, 50, 80]);
                } else {
                    navigator.vibrate(80);
                }
            }
        }, 30); // 30ms Versatz nach dem Ton
    } catch (err) {
        console.log('Haptik Fehler:', err);
    }
}

// --- ZENTRALER TON-HELFER ---
function playBeep(type = 'success') {
    try {
   // AudioContext einmalig initialisieren und für alle weiteren Beeps wiederverwenden
        if (!cachedAudioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                cachedAudioCtx = new AudioContextClass();
            }
        }

        const audioCtx = cachedAudioCtx;
        if (!audioCtx) return;

        // Falls der Kontext im Energiesparmodus ist, wieder aufwecken
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';

        // SCHRITT 1: Fester Zeit-Ankerpunkt für präzise Steuerung
        const now = audioCtx.currentTime;

        if (type === 'error' || type === 'duplicate') {
            // Einheitlicher, tiefer Ton (300 Hz) bei Fehlern & Duplikaten
            oscillator.frequency.setValueAtTime(300, now);

            // SCHRITT 2: Lautstärke-Muster für den Doppel-Beep (An-Aus-An-Aus)
            gainNode.gain.setValueAtTime(0, now);          // Start bei 0
            gainNode.gain.setValueAtTime(0.6, now);        // 1. Beep AN (0s)
            gainNode.gain.setValueAtTime(0, now + 0.10);   // 1. Beep AUS (nach 0.10s)
            gainNode.gain.setValueAtTime(0.6, now + 0.16); // 2. Beep AN (nach 0.16s)
            gainNode.gain.setValueAtTime(0, now + 0.26);   // 2. Beep AUS (nach 0.26s)

            triggerHaptic('error');
        } else {
            // Heller, klarer Ton (A5) bei erfolgreichem Scan
            oscillator.frequency.setValueAtTime(880, now);
            gainNode.gain.setValueAtTime(0.5, now);

            triggerHaptic('success');
        }

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        // SCHRITT 3: Start mit dem festen Zeit-Anker
        oscillator.start(now);

        // SCHRITT 4: Stopp-Zeit dynamisch anpassen (Erfolg = kurz, Fehler = lang genug für den Doppel-Beep)
        const stopDuration = (type === 'error' || type === 'duplicate') ? 0.28 : 0.15;
        oscillator.stop(now + stopDuration);

    } catch (err) {
        console.log('Audio konnte nicht abgespielt werden:', err);
    }
}

// Erfolgs-Signal (Vibration + Toast)
function showSuccessSignal(message) {
    showToast('Erfolg', message, 'success');
}

// Fehler-Signal (Vibration + Toast)
function showErrorSignal(message) {
    showToast('Fehler', message, 'error');
}

function showToast(title, message, type = 'success') {
// Prüfen, ob das Scanner-Overlay aktuell auf dem Bildschirm sichtbar ist
    const scannerOverlay = document.getElementById('scannerOverlay');
    const isScannerActive = scannerOverlay && !scannerOverlay.classList.contains('hidden');
    if (isScannerActive) {
        // --- ZENTRIERTER SCANNER-TOAST (Nur Success & Error) ---
        const toastEl = document.getElementById('scannerToast');
        const toastTitle = document.getElementById('scannerToastTitle');
        const toastMessage = document.getElementById('scannerToastMessage');
        const toastIcon = document.getElementById('scannerToastIcon');

        if (!toastEl) return;

        toastTitle.textContent = title;
        toastMessage.textContent = message;

        // Nur Erfolg oder Fehler im Scanner anzeigen
        if (type === 'error') {
            toastIcon.innerHTML = '⚠️';
            toastEl.className = toastEl.className.replace(/border-\w+-\d+/, 'border-rose-500');
        } else {
            toastIcon.innerHTML = '✅';
            toastEl.className = toastEl.className.replace(/border-\w+-\d+/, 'border-emerald-500');
        }

        // Einblenden in der Mitte
        toastEl.classList.remove('scale-0', 'opacity-0');
        toastEl.classList.add('scale-100', 'opacity-100');

        if (scannerToastTimeout) clearTimeout(scannerToastTimeout);
        scannerToastTimeout = setTimeout(() => {
            toastEl.classList.remove('scale-100', 'opacity-100');
            toastEl.classList.add('scale-0', 'opacity-0');
        }, 2500);

    } else {
        // --- NORMALER DESKTOP-TOAST (Alle 3 Typen: success, error, info) ---
        const toastEl = document.getElementById('toast'); // Hier liegt der normale Toast
        if (!toastEl) return;

        const toastTitle = document.getElementById('toastTitle');
        const toastMessage = document.getElementById('toastMessage');
        const toastIcon = document.getElementById('toastIcon');

        toastTitle.textContent = title;
        toastMessage.textContent = message;

        if (type === 'success') {
            toastIcon.innerHTML = '✅';
            toastEl.className = toastEl.className.replace(/border-\w+-\d+/, 'border-emerald-500');
        } else if (type === 'error') {
            toastIcon.innerHTML = '⚠️';
            toastEl.className = toastEl.className.replace(/border-\w+-\d+/, 'border-rose-500');
        } else {
            toastIcon.innerHTML = 'ℹ️';
            toastEl.className = toastEl.className.replace(/border-\w+-\d+/, 'border-indigo-500');
        }

        // Einblenden via Tailwind-Transformationen
        toastEl.classList.remove('translate-y-20', 'opacity-0');
        toastEl.classList.add('translate-y-0', 'opacity-100');

        // Alten Timer löschen, falls ein Toast bereits aktiv war
        if (toastTimeout) clearTimeout(toastTimeout);

        // Nach 3 Sekunden automatisch wieder ausblenden
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('translate-y-0', 'opacity-100');
            toastEl.classList.add('translate-y-20', 'opacity-0');
        }, 3000);
    }
}

/* =================================== */
/*      Daten & Tabellen-Management    */
/* =================================== */
// processScannedCode, addSnToTable, renderTable, deleteRecord.

// HAUPTFUNKTION: Verarbeitet den gescannten Code
function processScannedCode(scannedCode) {
    if (!scannedCode) return;

    // Zentrales Trimmen (nur am Ende!)
    const cleanCode = String(scannedCode).trimEnd();
    // Ist es eine BIN ID?
    if (isValidBinId(cleanCode)) {
        setActiveBinId(cleanCode.toUpperCase());
        showSuccessSignal(`BIN ID gesetzt: ${cleanCode.toUpperCase()}`);
        playBeep();
        if (manualInput) manualInput.value = '';
        return;
    }
    // Prüfen, ob bereits eine BIN ID aktiv ist -> FEHLER
    if (!activeBinId) {
        playBeep('error');
        showErrorSignal("Bitte zuerst eine gültige BIN ID scannen!");
        return;
    }
    // Prüfen, ob die Seriennummer formal gültig ist -> FEHLER
    if (!isValidSN(cleanCode)) {
        playBeep('error');
        showErrorSignal("Ungültige Seriennummer (max. 25 Zeichen erlaubt)!");
        return;
    }

    const isDuplicate = scanRecords.some(record => record.sn === cleanCode);
    addSnToTable(activeBinId, cleanCode, isDuplicate);
    if (isDuplicate) {
        // Dublette-Hinweis: Ton + Haptik-Impuls
        playBeep('duplicate');
        showToast('Hinweis', `SN ${cleanCode} ist eine Dublette!`, 'error');
    } else {
        // Normaler Erfolg: Heller Ton + kurzer Haptik-Impuls
        playBeep('success');
        showSuccessSignal(`SN erfasst: ${cleanCode}`);
    }
}

// Speichert die gescannte Seriennummer im Array
function addSnToTable(binId, snCode, isDuplicate = false) {
    const newRecord = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        binId: binId,
        sn: snCode,
        isDuplicate: isDuplicate
    };

    scanRecords.unshift(newRecord);
    persistData();
    renderTable();
}

function renderTable() {
    scanTableBody.innerHTML = '';
    scanCountBadge.textContent = `${scanRecords.length} Scans`;

    if (scanRecords.length === 0) {
        scanTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="p-6 text-center text-slate-500 text-xs italic">
          Noch keine Scans vorhanden. Scanne einen Code mit der Kamera oder nutze die manuelle Eingabe.
        </td>
      </tr>
    `;
        return;
    }

    // 1. SCHRITT: Zählen, wie oft jede Seriennummer im Array vorkommt
    const snCounts = {};
    scanRecords.forEach(r => {
        snCounts[r.sn] = (snCounts[r.sn] || 0) + 1;
    });

    // index zur Schleife hinzugefügt (record, index)
    scanRecords.forEach((record, index) => {
        const tr = document.createElement('tr');
        tr.id = `row-${record.id}`;

        // 2. SCHRITT: data-sn Attribut setzen
        tr.setAttribute('data-sn', record.sn);

        // 3. SCHRITT: Prüfen, ob die SN mehr als 1x vorkommt
        const isDup = snCounts[record.sn] > 1;

        // 4. SCHRITT: Doppelte SN rot markieren
        if (isDup) {
            tr.className = "border-b border-red-700 transition-colors";
            tr.style.backgroundColor = THEME_COLORS.duplicateBg;
            tr.style.color = THEME_COLORS.baseBg;
        } else {
            // Normale Zeile mit Zebra-Muster
            tr.className = "border-b border-slate-700/50 transition-colors hover:bg-slate-700/30";
            if (index % 2 === 0) {
                tr.style.backgroundColor = THEME_COLORS.baseBg;
            } else {
                tr.style.backgroundColor = THEME_COLORS.zebraBg; // Sanft abgesetzter Zebra-Ton
            }
            tr.style.color = "";
        }

        tr.innerHTML = `
            <td class="p-3 text-xs ${isDup ? 'text-red-200' : 'text-slate-400'}">${record.timestamp}</td>
            <td class="p-3 ${isDup ? 'text-white font-bold' : 'text-amber-400 font-bold'}">${escapeHtml(record.binId)}</td>
            <td class="p-3 font-semibold text-white">${escapeHtml(record.sn)}</td>
            <td class="p-3 text-right">
                <button onclick="deleteRecord('${record.id}')" class="text-xs text-rose-300 hover:text-rose-100 p-1 rounded hover:bg-rose-900/60">
                    🗑️
                </button>
            </td>
        `;
        scanTableBody.appendChild(tr);
    });
}

function deleteRecord(id) {
    scanRecords = scanRecords.filter(r => r.id !== id);
    persistData();
    renderTable();
    showToast('Eintrag gelöscht', 'Die Zeile wurde entfernt.', 'info');
}

// 3. HELPER: Visuelle Hervorhebung einer doppelten Tabellenzeile
function highlightDuplicateRow(rowElement) {
    // Vorherige Warnungen entfernen
    document.querySelectorAll('.duplicate-warning').forEach(el => el.classList.remove('duplicate-warning'));

    // Zeile rot markieren und sanft ins Bild scrollen
    rowElement.classList.add('duplicate-warning');
    rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Nach 3 Sekunden die rote Markierung wieder entfernen
    setTimeout(() => {
        rowElement.classList.remove('duplicate-warning');
    }, 3000);
}

/* ==================================== */
/*        Kamera & ZXING-SCANNER        */
/* ==================================== */
// startCamera, stopCamera, triggerHardwareScan.

function startCamera() {
    // 1. Nur Code 39 (Code 3 of 9) als einziges Format erlauben
    const hints = new Map();
    const formats = [
        ZXing.BarcodeFormat.CODE_39,
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);

    // 2. Den Reader mit den Hints initialisieren
    codeReader = new ZXing.BrowserMultiFormatReader(hints);

    // 3. Kamera-Einstellungen für hohe Auflösung & scharfen Fokus definieren
    const constraints = {
        video: {
            facingMode: "environment", // Nutzt direkt die Hauptkamera (Rückseite)
            width: { ideal: 1280 },    // Höhere Auflösung für kleine Barcodes
            height: { ideal: 720 },
            advanced: [{ focusMode: "continuous" }]
        }
    };

    codeReader.decodeFromConstraints(constraints, 'video', (result, err) => {
        if (result) {
            if (!canProcessScan) return;

            const targetBox = document.getElementById('targetScanBox');
            const videoEl = document.getElementById('video');

            if (targetBox && videoEl) {
                const boxRect = targetBox.getBoundingClientRect();
                const points = result.getResultPoints();

                if (points && points.length > 0) {
                    // Wir prüfen mindestens einen Punkt des Barcodes gegen die Box-Koordinaten
                    // Da die Video-Anzeige skaliert ist, nutzen wir die clientX/clientY-Prüfung oder Punkt-Normalisierung.
                    // Ein robuster Ansatz für Web/Mobile: Prüfen ob Result-Points im relativen Bildschirmbereich liegen.
                    const videoRect = videoEl.getBoundingClientRect();

                    // Umrechnung der Video-Pixelpunkte auf die tatsächliche Display-Größe
                    // (ZXing liefert Punkte im nativen Video-Koordinatensystem)
                    const scaleX = videoRect.width / videoEl.videoWidth;
                    const scaleY = videoRect.height / videoEl.videoHeight;

                    let isInside = false;
                    for (const point of points) {
                        const screenX = videoRect.left + (point.getX() * scaleX);
                        const screenY = videoRect.top + (point.getY() * scaleY);

                        // Prüfen, ob der Punkt innerhalb des Zielrahmens (targetScanBox) liegt
                        if (
                            screenX >= boxRect.left &&
                            screenX <= boxRect.right &&
                            screenY >= boxRect.top &&
                            screenY <= boxRect.bottom
                        ) {
                            isInside = true;
                            break;
                        }
                    }

                    // Wenn der Barcode NICHT im roten Rahmen liegt, ignorieren wir ihn einfach!
                    if (!isInside) {
                        return;
                    }
                }
            }

            const code = result.getText();

            // Debounce, um Mehrfachscans in Millisekunden zu verhindern
            if (code !== lastScannedCode) {
                lastScannedCode = code;
                processScannedCode(code);

                canProcessScan = false;

                clearTimeout(scanDebounceTimer);
                scanDebounceTimer = setTimeout(() => {
                    lastScannedCode = '';
                    canProcessScan = true;
                }, 1500);
            }
        }
    }).then(() => {
        isCameraActive = true;
        videoEl.classList.remove('hidden');
        scannerOverlay.classList.remove('hidden');
        cameraPlaceholder.classList.add('hidden');

        // Scan Button kommt, nachdem die Kamera aktiviert wurde
        const scanButtonContainer = document.getElementById('scanButtonContainer');
        if (scanButtonContainer) scanButtonContainer.classList.remove('hidden');

        // Vollbildmodus aktivieren
        if (videoContainer) {
            videoContainer.classList.add('camera-fullscreen-mode');
        }
        document.body.classList.add('overflow-hidden');

        const closeBtn = document.getElementById('closeFullscreenBtn');
        if (closeBtn) closeBtn.classList.remove('hidden');


        if (toggleCameraBtn) {
            toggleCameraBtn.classList.add('hidden');
        };
    }).catch((err) => {
        console.error('Kamerafehler:', err);
        showToast('Kamerafehler', 'Zugriff auf Kamera fehlgeschlagen.', 'error');
    });
}

function stopCamera() {
    // 1. CodeReader stoppen / zurücksetzen
    if (codeReader) {
        try {
            codeReader.reset();
            codeReader = null;
        } catch (e) {
            console.error("Fehler beim Zurücksetzen des CodeReaders:", e);
        }
    }

    isCameraActive = false;

    // 2. Video & Overlay verstecken, Placeholder wieder zeigen
    if (videoEl) videoEl.classList.add('hidden');
    if (scannerOverlay) scannerOverlay.classList.add('hidden');
    if (cameraPlaceholder) cameraPlaceholder.classList.remove('hidden');

    // Scan-Button im Vollbild ausblenden
    const scanButtonContainer = document.getElementById('scanButtonContainer');
    if (scanButtonContainer) scanButtonContainer.classList.add('hidden');

    // Vollbildmodus zurücksetzen
    if (videoContainer) {
        videoContainer.classList.remove('camera-fullscreen-mode');
    }

    document.body.classList.remove('overflow-hidden');

    const closeBtn = document.getElementById('closeFullscreenBtn');
    if (closeBtn) closeBtn.classList.add('hidden');

    // WICHTIG: Den "Kamera starten"-Button auf der Karte wieder sichtbar machen!
    if (toggleCameraBtn) {
        toggleCameraBtn.classList.remove('hidden');
    }
}

// Globale Funktion für den Hardware-Button (Leiser-Taste am Gehäuse)
window.triggerHardwareScan = function () {
    console.log("Hardware-Taste (Leiser) gedrückt!");

    // Wenn die Kamera aktiv ist und ein Code im Fokus steht / erfasst wurde
    if (isCameraActive && lastScannedCode) {
        processScannedCode(lastScannedCode);
        showToast('Code erfasst (Hardware)', lastScannedCode, 'success');
    } else if (isCameraActive) {
        showToast('Bereit', 'Bitte halte die Kamera auf einen Barcode', 'info');
    } else {
        showToast('Kamera inaktiv', 'Bitte starte zuerst die Kamera', 'warning');
    }
};

/* ================================= */
/*           HTML BUILDER            */
/* ================================= */
function buildExportHtml(records) {
    const todayFormatted = new Date().toLocaleDateString('de-DE');
    const totalScans = records.length;
    const sortedRecords = [...records].reverse();

    let previousBinId = null;

    // Tabellenzeilen generieren
    const tableRowsHtml = sortedRecords.map((record, index) => {
        // Prüfen, ob ein neuer BIN-Block beginnt (Wechsel des Lagerplatzes)
        const isNewBlock = previousBinId !== null && record.binId !== previousBinId;
        previousBinId = record.binId;

        // Styling für die Trennlinie: Bei neuem Block eine dicke, dunkle Linie
        const rowStyle = isNewBlock
            ? `border-top: 4px solid ${EXPORT_COLORS.borderDark}; background-color: ${index % 2 === 0 ? EXPORT_COLORS.bg : EXPORT_COLORS.zebraBg};`
            : `border-top: 1px solid ${EXPORT_COLORS.borderDark}; background-color: ${index % 2 === 0 ? EXPORT_COLORS.bg : EXPORT_COLORS.zebraBg};`;

        return `
            <tr style="${rowStyle}">
                <td style="padding: 10px;">
                    <span style="font-weight: bold; color: ${EXPORT_COLORS.text}; font-family: monospace;">${escapeHtml(record.binId)}</span>
                    <button class="btn-copy" onclick="copyText('${escapeHtml(record.binId)}', this)" title="BIN kopieren">📋</button>
                </td>
                <td style="padding: 10px;">
                    <span style="font-weight: 600; color: ${EXPORT_COLORS.text}; font-family: monospace;">${escapeHtml(record.sn)}</span>
                    <button class="btn-copy" onclick="copyText('${escapeHtml(record.sn)}', this)" title="SN kopieren">📋</button>
                </td>
            </tr>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Put Away - Scan List</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background-color: ${EXPORT_COLORS.bg};
            color: ${EXPORT_COLORS.text};
        }
        .container {
            width: 100%;    
            max-width: 100%;
            margin: 0;
            background: ${EXPORT_COLORS.bg};
            padding: 12px;
            box-sizing: border-box;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid ${EXPORT_COLORS.border};
            padding-bottom: 16px;
            margin-bottom: 20px;
        }
        h1 { font-size: 20px; margin: 0; color: ${EXPORT_COLORS.text}; }
        .badge {
            background-color: ${EXPORT_COLORS.border};
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 14px;
        }
        th {
            background-color: ${EXPORT_COLORS.borderDark};
            color: ${EXPORT_COLORS.bg};
            border-bottom: 2px solid ${EXPORT_COLORS.border};
            padding: 10px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .btn-copy {
            margin-left: 8px;
            padding: 2px 6px;
            font-size: 11px;
            cursor: pointer;
            border: 1px solid ${EXPORT_COLORS.zebraBg};
            background: ${EXPORT_COLORS.bg};
            border-radius: 4px;
            transition: all 0.2s;
        }
        .btn-copy:hover {
            background: ${EXPORT_COLORS.borderDark};
            border-color: ${EXPORT_COLORS.border};
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Put Away - ${todayFormatted}</h1>
        </div>
        <table>
            <thead>
                <tr>
                    <th>BIN (Lagerplatz)</th>
                    <th>Seriennummer (SN)</th>
                </tr>
            </thead>
            <tbody>
                ${tableRowsHtml}
            </tbody>
        </table>
    </div>
    <script>
function copyText(text, btn) {
            // Hilfsfunktion für das visuelle Feedback (Häkchen)
            function showSuccess() {
                const orig = btn.innerText;
                btn.innerText = '✅';
                setTimeout(() => { btn.innerText = orig; }, 1000);
            }

            // Versuch 1: Moderne Clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(showSuccess).catch(() => {
                    fallbackCopy(text);
                });
            } else {
                // Versuch 2: Ausweichmethode für unsichere Umgebungen / Popups
                fallbackCopy(text);
            }

            function fallbackCopy(textToCopy) {
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    showSuccess();
                } catch (err) {
                    alert('Kopieren fehlgeschlagen');
                }
                document.body.removeChild(textArea);
            }
        }
    </script>
</body>
</html>`;
}

/* ========================================== */
/*     UI-EVENT-LISTENER & INITIALISIERUNG    */
/* ========================================== */
// showOverview, hideOverview, captureScanBtn, closeFullscreenBtn, toggleCameraBtn, manualInputForm, clearBtn, exportViewBtn, sendEmailBtn, copyClipboardBtn

// Funktion zum Öffnen der Übersicht
function showOverview() {
    const htmlContent = buildExportHtml(scanRecords);

    const container = document.getElementById('overviewContentContainer');
    if (container) {
        container.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.className = 'w-full border-0 bg-white rounded-lg';
        iframe.srcdoc = htmlContent;

        // MAGIE: Höhe automatisch an den Inhalt anpassen, sobald das Iframe lädt
        iframe.onload = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (doc && doc.body) {
                    // Setzt die Iframe-Höhe exakt auf die Höhe der Tabellen-Inhalte
                    iframe.style.height = doc.body.scrollHeight + 'px';
                }
            } catch (e) {
                console.error("Konnte Iframe-Höhe nicht anpassen:", e);
            }
        };

        container.appendChild(iframe);
    }

    // Ansichten umschalten: Hauptseite verstecken, Übersicht einblenden
    const mainView = document.getElementById('mainAppView');
    const overviewView = document.getElementById('overviewView');
    if (mainView) mainView.classList.add('hidden');
    if (overviewView) overviewView.classList.remove('hidden');

    window.scrollTo(0, 0);
    showToast('Übersicht geöffnet', 'Tabellenansicht wurde geladen.', 'success');
}

// Funktion zum Schließen der Übersicht und Rückkehr zur Homepage
function hideOverview() {
    const mainView = document.getElementById('mainAppView');
    const overviewView = document.getElementById('overviewView');

    if (overviewView) overviewView.classList.add('hidden');
    if (mainView) mainView.classList.remove('hidden');
}

// Event-Listener für Buttons und Formulare
const captureScanBtn = document.getElementById('captureScanBtn');
if (captureScanBtn) {
    captureScanBtn.addEventListener('click', () => {
        // 1. Scanner für den nächsten Barcode freischalten
        canProcessScan = true;
        // 2. Prüfen, ob die Kamera aktuell einen Code im Blick hat
        if (lastScannedCode) {
            processScannedCode(lastScannedCode);
            showToast('Code erfasst', lastScannedCode, 'success');
        } else {
            // Optional: Wenn man drückt, aber kein Code da ist, 
            // kannst du hier auch direkt deinen Error-Beep/Haptic triggern, falls gewollt!
            showToast('Kein Code', 'Bitte halte die Kamera über einen Barcode.', 'error');
        }
    });
}

// Stopp die Kamera nach X
const closeFullscreenBtn = document.getElementById('closeFullscreenBtn');
if (closeFullscreenBtn) {
    closeFullscreenBtn.addEventListener('click', () => {
        stopCamera();
    });
}

// UI-Schnittstelle: Kamera umschalten
const toggleCameraBtn = document.getElementById('toggleCameraBtn');
if (toggleCameraBtn) {
    toggleCameraBtn.addEventListener('click', async () => {
        if (isCameraActive) {
            stopCamera();
        } else {
            try {
                // Aktiv die Berechtigung vom Android-System anfordern
                await navigator.mediaDevices.getUserMedia({ video: true });
                startCamera();
            } catch (err) {
                console.error('Kameraberechtigung verweigert:', err);
                showToast('Berechtigung fehlt', 'Bitte erlaube den Kamerazugriff in den Android-Einstellungen.', 'error');
            }
        }
    });
}

const manualInputForm = document.getElementById('manualInputForm');
if (manualInputForm) {
    manualInputForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = manualInput.value;
        if (val) {
            processScannedCode(val);
            manualInput.value = '';

            // Mit kurzer Verzögerung den Fokus erzwingen, damit die Handytastatur garantiert offen bleibt
            setTimeout(() => {
                manualInput.focus();
            }, 100);
        }
    });
}

const clearBtn = document.getElementById('clearBtn');
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (scanRecords.length === 0 && !activeBinId) return;
        if (confirm('Möchten Sie alle erfassten Scans wirklich löschen?')) {
            scanRecords = [];
            activeBinId = null;
            localStorage.removeItem('putaway_scan_records');
            localStorage.removeItem('putaway_active_bin');
            if (activeBinDisplay) {
                activeBinDisplay.textContent = '-- Nicht gesetzt --';
            }
            renderTable();
            showToast('Tabelle geleert', 'Alle Daten wurden zurückgesetzt', 'info');
        }
    });
}

if (exportViewBtn) {
    exportViewBtn.addEventListener('click', () => {
        if (scanRecords.length === 0) {
            showToast('Export nicht möglich', 'Tabelle ist leer!', 'error');
            return;
        }
        showOverview();
    });
}

// Event-Listener für den Zurück-Button in der Übersicht
document.getElementById('backToAppBtn')?.addEventListener('click', () => {
    hideOverview();
});

if (sendEmailBtn) {
    sendEmailBtn.addEventListener('click', () => {
        const totalScans = scanRecords.length;
        if (totalScans === 0) {
            showToast('E-Mail nicht möglich', 'Keine Daten vorhanden.', 'error');
            return;
        }
        // Zeitstempel über Hilfsfunktion abrufen
        const { dateCode, dateDotted, timeCode } = getFormattedTimestamp();
        const fileName = `PutAway_${dateCode}_${timeCode}.html`;
        const subject = encodeURIComponent(`PutAway - ${dateDotted} - ${totalScans} Scans`);
        const bodyText = encodeURIComponent(`Hallo,\n\nanbei die interaktive Datei mit ${totalScans} Scans für die Umbuchung.\n\nViele Grüße`);

        // HTML-Datei erzeugen & Download auslösen
        const blob = new Blob([buildExportHtml(scanRecords)], { type: 'text/html;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // E-Mail-Client öffnen & Feedback anzeigen
        window.open(`mailto:?subject=${subject}&body=${bodyText}`, '_blank');
        showToast('Export gestartet', 'HTML-Datei heruntergeladen & E-Mail geöffnet!', 'success');
    });
}

// In Zwischenablage kopieren (Nur BIN und SN, älteste Scans zuerst)
if (copyClipboardBtn) {
    copyClipboardBtn.addEventListener('click', () => {
        if (scanRecords.length === 0) {
            showToast('Kopieren nicht möglich', 'Keine Daten vorhanden.', 'error');
            return;
        }
        // 1. SCHRITT: Header ohne Zeit definieren (optional, nur BIN und SN)
        let text = 'BIN\tSeriennummer\n';
        // dreht die Liste um (chronologisch von alt nach neu)
        [...scanRecords].reverse().forEach(r => {
            text += `${r.binId}\t${r.sn}\n`;
        });

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Kopiert!', 'Daten liegen in der Zwischenablage.', 'success');
            });
        } else {
            // Fallback
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast('Kopiert!', 'Daten liegen in der Zwischenablage.', 'success');
        }
    });
}