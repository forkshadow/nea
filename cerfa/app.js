const DOCS = {
  sellerId: { label: "ID vendeur" },
  registration: { label: "Carte grise" },
  buyerId: { label: "ID acheteur" }
};

const documentImages = {
  sellerId: null,
  registration: null,
  buyerId: null
};

const progressEl = document.getElementById("ocrProgress");
const statusEl = document.getElementById("ocrStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const pdfBtn = document.getElementById("pdfBtn");
const printBtn = document.getElementById("printBtn");
const formEl = document.getElementById("cerfaForm");

const cameraDialog = document.getElementById("cameraDialog");
const cameraVideo = document.getElementById("cameraVideo");
const cameraCanvas = document.getElementById("cameraCanvas");
const captureBtn = document.getElementById("captureBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const cameraStatus = document.getElementById("cameraStatus");

let currentCameraDocKey = null;
let cameraStream = null;

initUploadHandlers();
initCameraHandlers();
initActions();

function initUploadHandlers() {
  Object.keys(DOCS).forEach((key) => {
    const fileInput = document.getElementById(`${key}-file`);
    const captureInput = document.getElementById(`${key}-capture`);

    fileInput.addEventListener("change", (event) => onInputFile(key, event));
    captureInput.addEventListener("change", (event) => onInputFile(key, event));
  });
}

function onInputFile(docKey, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setDocImage(docKey, file);
}

function setDocImage(docKey, fileOrBlob) {
  const file = fileOrBlob instanceof File
    ? fileOrBlob
    : new File([fileOrBlob], `${docKey}.jpg`, { type: fileOrBlob.type || "image/jpeg" });

  documentImages[docKey] = file;
  const url = URL.createObjectURL(file);
  const preview = document.getElementById(`${docKey}-preview`);
  preview.src = url;
}

function initCameraHandlers() {
  document.querySelectorAll("[data-open-camera]").forEach((button) => {
    button.addEventListener("click", async () => {
      currentCameraDocKey = button.dataset.openCamera;
      await openAdvancedCamera();
    });
  });

  captureBtn.addEventListener("click", async () => {
    if (!cameraStream || !currentCameraDocKey) return;

    const track = cameraStream.getVideoTracks()[0];
    const settings = track.getSettings();
    const width = settings.width || 1280;
    const height = settings.height || 720;

    cameraCanvas.width = width;
    cameraCanvas.height = height;

    const ctx = cameraCanvas.getContext("2d");
    ctx.drawImage(cameraVideo, 0, 0, width, height);

    const blob = await new Promise((resolve) => cameraCanvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      cameraStatus.textContent = "Capture impossible. Réessayez.";
      return;
    }

    setDocImage(currentCameraDocKey, blob);
    cameraStatus.textContent = "Photo capturée avec succès.";
    closeAdvancedCamera();
  });

  closeCameraBtn.addEventListener("click", () => closeAdvancedCamera());
  cameraDialog.addEventListener("close", () => closeAdvancedCamera());
}

async function openAdvancedCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    cameraVideo.srcObject = cameraStream;
    cameraStatus.textContent = "Caméra active. Cadrez le document puis capturez.";
    if (!cameraDialog.open) cameraDialog.showModal();
  } catch (error) {
    cameraStatus.textContent = `Caméra indisponible : ${error.message}`;
    if (!cameraDialog.open) cameraDialog.showModal();
  }
}

function closeAdvancedCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (cameraDialog.open) cameraDialog.close();
}

function initActions() {
  analyzeBtn.addEventListener("click", analyzeDocuments);
  pdfBtn.addEventListener("click", generatePdfSummary);
  printBtn.addEventListener("click", () => window.print());
}

async function analyzeDocuments() {
  const tasks = Object.entries(documentImages).filter(([, file]) => !!file);
  if (tasks.length === 0) {
    setProgress(0, "Aucun document fourni. Vous pouvez remplir le formulaire manuellement.");
    return;
  }

  const extracted = {};
  let completed = 0;

  for (const [docKey, file] of tasks) {
    statusEl.textContent = `OCR en cours: ${DOCS[docKey].label}...`;
    const text = await runOcr(file, docKey, tasks.length, completed);
    extracted[docKey] = extractFields(text, docKey);
    completed += 1;
  }

  prefillForm(mergeExtractedData(extracted));
  setProgress(100, "Analyse terminée. Vérifiez puis corrigez le formulaire si nécessaire.");
}

async function runOcr(file, docKey, total, completed) {
  try {
    if (!window.Tesseract || !window.Tesseract.createWorker) {
      throw new Error("Tesseract indisponible.");
    }

    const worker = await window.Tesseract.createWorker("fra");
    const result = await worker.recognize(file, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          const docProgress = Math.round((m.progress || 0) * (100 / total));
          const base = Math.round((completed / total) * 100);
          const next = Math.min(99, base + docProgress);
          setProgress(next, `OCR ${DOCS[docKey].label}: ${Math.round((m.progress || 0) * 100)}%`);
        }
      }
    });

    await worker.terminate();
    return (result?.data?.text || "").trim();
  } catch (error) {
    console.warn("OCR failed", docKey, error);
    setProgress(Math.round(((completed + 1) / total) * 100), `OCR faible pour ${DOCS[docKey].label}. Champs laissés vides.`);
    return "";
  }
}

function extractFields(text, docKey) {
  if (!text) return {};

  const normalized = text.replace(/\s+/g, " ").trim();
  const dateMatches = normalized.match(/\b(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})\b/g) || [];

  const out = {};
  const plate = normalized.match(/\b[A-Z]{2}[\-\s]?\d{3}[\-\s]?[A-Z]{2}\b/i);
  const vin = normalized.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i);

  if (docKey === "registration") {
    out.plate = plate?.[0]?.toUpperCase().replace(/\s/g, "-") || "";
    out.vin = vin?.[0] || "";
    out.brand = grabAfterKeyword(normalized, ["marque", "constructeur"]);
    out.model = grabAfterKeyword(normalized, ["type", "variante", "version", "modele", "modèle"]);
  }

  if (docKey === "sellerId" || docKey === "buyerId") {
    const target = docKey === "sellerId" ? "seller" : "buyer";
    out[`${target}Name`] = grabAfterKeyword(normalized, ["nom", "surname"]) || "";
    out[`${target}FirstName`] = grabAfterKeyword(normalized, ["prenom", "prénom", "given name"]) || "";
    out[`${target}BirthDate`] = dateMatches[0] || "";
    out[`${target}Address`] = grabAfterKeyword(normalized, ["adresse", "address", "domicile"]) || "";
  }

  out.saleDate = out.saleDate || dateMatches[1] || "";
  return out;
}

function grabAfterKeyword(text, keywords) {
  for (const key of keywords) {
    const re = new RegExp(`${key}\\s*[:\\-]?\\s*([A-ZÀ-ÿa-z0-9' .-]{2,60})`, "i");
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function mergeExtractedData(byDoc) {
  return Object.values(byDoc).reduce((acc, item) => ({ ...acc, ...item }), {});
}

function prefillForm(values) {
  const fields = new FormData(formEl);
  for (const key of fields.keys()) {
    const input = formEl.elements.namedItem(key);
    if (!input || typeof input.value === "undefined") continue;
    input.value = values[key] || "";
  }
}

function setProgress(percent, text) {
  progressEl.value = percent;
  statusEl.textContent = text;
}

async function generatePdfSummary() {
  try {
    const { PDFDocument, StandardFonts } = window.PDFLib || {};
    if (!PDFDocument || !StandardFonts) throw new Error("pdf-lib indisponible.");

    const data = Object.fromEntries(new FormData(formEl).entries());
    const lines = [
      "Récapitulatif cession véhicule (MVP local)",
      "",
      "Vendeur:",
      `- Nom: ${data.sellerName || ""}`,
      `- Prénom: ${data.sellerFirstName || ""}`,
      `- Naissance: ${data.sellerBirthDate || ""}`,
      `- Adresse: ${data.sellerAddress || ""}`,
      "",
      "Acheteur:",
      `- Nom: ${data.buyerName || ""}`,
      `- Prénom: ${data.buyerFirstName || ""}`,
      `- Naissance: ${data.buyerBirthDate || ""}`,
      `- Adresse: ${data.buyerAddress || ""}`,
      "",
      "Véhicule:",
      `- Immatriculation: ${data.plate || ""}`,
      `- VIN: ${data.vin || ""}`,
      `- Marque: ${data.brand || ""}`,
      `- Modèle: ${data.model || ""}`,
      "",
      "Cession:",
      `- Date: ${data.saleDate || ""}`,
      `- Heure: ${data.saleTime || ""}`,
      `- Lieu: ${data.salePlace || ""}`,
      "",
      "Traitement local uniquement - Aucun envoi"
    ];

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let y = 810;
    lines.forEach((line) => {
      page.drawText(line, { x: 40, y, size: 11, font });
      y -= 18;
    });

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cerfa-recapitulatif.pdf";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error);
    alert("Impossible de générer le PDF. Vérifiez que la librairie locale est chargée.");
  }
}
