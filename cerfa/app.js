console.log("[CERFA] app.js loaded");

const DOCS = {
  seller: { label: "ID vendeur", keys: ["seller_file", "seller_capture"], preview: "seller_preview" },
  registration: { label: "Carte grise", keys: ["registration_file", "registration_capture"], preview: "registration_preview" },
  buyer: { label: "ID acheteur", keys: ["buyer_file", "buyer_capture"], preview: "buyer_preview" }
};

const state = {
  files: { seller: null, registration: null, buyer: null },
  cameraDocKey: null,
  cameraStream: null
};

const ui = {
  analyzeBtn: document.getElementById("analyzeBtn"),
  pdfBtn: document.getElementById("pdfBtn"),
  templatePdfBtn: document.getElementById("templatePdfBtn"),
  printBtn: document.getElementById("printBtn"),
  progressEl: document.getElementById("ocrProgress"),
  statusEl: document.getElementById("ocrStatus"),
  uiMessageEl: document.getElementById("uiMessage"),
  formEl: document.getElementById("cerfaForm"),
  cameraDialog: document.getElementById("cameraDialog"),
  cameraVideo: document.getElementById("cameraVideo"),
  cameraCanvas: document.getElementById("cameraCanvas"),
  cameraStatus: document.getElementById("cameraStatus"),
  captureBtn: document.getElementById("captureBtn"),
  closeCameraBtn: document.getElementById("closeCameraBtn")
};

init();

function init() {
  try {
    wireUploads();
    wireCamera();
    wireActions();
    ensureTodayDate();
  } catch (err) {
    console.error("[CERFA] init error", err);
  }
}

function wireUploads() {
  Object.entries(DOCS).forEach(([docKey, cfg]) => {
    cfg.keys.forEach((inputId) => {
      const input = document.getElementById(inputId);
      if (!input) {
        console.error("[CERFA] missing input", inputId);
        return;
      }
      input.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setDocumentFile(docKey, file);
      });
    });
  });
}

function setDocumentFile(docKey, fileOrBlob) {
  try {
    const file = fileOrBlob instanceof File
      ? fileOrBlob
      : new File([fileOrBlob], `${docKey}.jpg`, { type: fileOrBlob.type || "image/jpeg" });

    state.files[docKey] = file;
    const preview = document.getElementById(DOCS[docKey].preview);
    if (!preview) {
      console.error("[CERFA] missing preview", DOCS[docKey].preview);
      return;
    }
    preview.src = URL.createObjectURL(file);
    setUiMessage(`${DOCS[docKey].label} chargé.`);
  } catch (err) {
    console.error("[CERFA] setDocumentFile error", err);
  }
}

function wireCamera() {
  document.querySelectorAll("[data-open-camera]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.cameraDocKey = btn.dataset.openCamera;
      await openAdvancedCamera();
    });
  });

  ui.captureBtn?.addEventListener("click", async () => {
    try {
      if (!state.cameraStream || !state.cameraDocKey) return;
      const track = state.cameraStream.getVideoTracks()[0];
      const settings = track.getSettings();
      const width = settings.width || 1280;
      const height = settings.height || 720;

      ui.cameraCanvas.width = width;
      ui.cameraCanvas.height = height;

      const ctx = ui.cameraCanvas.getContext("2d");
      ctx.drawImage(ui.cameraVideo, 0, 0, width, height);

      const blob = await new Promise((resolve) => ui.cameraCanvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("capture blob null");

      setDocumentFile(state.cameraDocKey, blob);
      ui.cameraStatus.textContent = "Photo capturée avec succès.";
      closeAdvancedCamera();
    } catch (err) {
      console.error("[CERFA] capture error", err);
      ui.cameraStatus.textContent = "Capture impossible.";
    }
  });

  ui.closeCameraBtn?.addEventListener("click", closeAdvancedCamera);
  ui.cameraDialog?.addEventListener("close", closeAdvancedCamera);
}

async function openAdvancedCamera() {
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    ui.cameraVideo.srcObject = state.cameraStream;
    ui.cameraStatus.textContent = "Caméra active. Cadrez puis capturez.";
    if (!ui.cameraDialog.open) ui.cameraDialog.showModal();
  } catch (err) {
    console.error("[CERFA] open camera error", err);
    ui.cameraStatus.textContent = `Caméra indisponible: ${err.message}`;
    if (!ui.cameraDialog.open) ui.cameraDialog.showModal();
  }
}

function closeAdvancedCamera() {
  try {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((track) => track.stop());
      state.cameraStream = null;
    }
    if (ui.cameraDialog.open) ui.cameraDialog.close();
  } catch (err) {
    console.error("[CERFA] close camera error", err);
  }
}

function wireActions() {
  ui.analyzeBtn?.addEventListener("click", async () => {
    console.log("[CERFA] analyze clicked");
    await analyzeDocuments();
  });

  ui.pdfBtn?.addEventListener("click", generateSummaryPdf);
  ui.templatePdfBtn?.addEventListener("click", inspectTemplatePdf);
  ui.printBtn?.addEventListener("click", () => window.print());
}

async function analyzeDocuments() {
  try {
    const tasks = Object.entries(state.files).filter(([, file]) => !!file);
    if (tasks.length === 0) {
      setProgress(0, "Aucune image chargée.");
      setUiMessage("Chargez au moins un document (fichier ou photo).");
      ensureTodayDate();
      return;
    }

    const extracted = {
      seller: {},
      buyer: {},
      vehicle: {},
      date: getTodayFr()
    };

    let done = 0;
    for (const [docKey, file] of tasks) {
      const text = await runOcr(docKey, file, tasks.length, done);
      done += 1;

      if (!text.trim()) {
        setUiMessage(`OCR vide pour ${DOCS[docKey].label}. Formulaire manuel toujours possible.`);
        continue;
      }

      if (docKey === "registration") {
        extracted.vehicle = extractFromRegistrationText(text);
      } else if (docKey === "seller") {
        extracted.seller = extractFromIdText(text);
      } else if (docKey === "buyer") {
        extracted.buyer = extractFromIdText(text);
      }
    }

    fillFormFromData(extracted);
    console.log("[CERFA] filled fields", extracted);
    setProgress(100, "Analyse terminée.");
    setUiMessage("Pré-remplissage appliqué (best effort). Vérifiez les champs.");
  } catch (err) {
    console.error("[CERFA] analyzeDocuments error", err);
    setUiMessage("Erreur pendant l'analyse. Vous pouvez remplir le formulaire manuellement.");
  }
}

async function runOcr(docKey, file, total, completed) {
  try {
    if (!window.Tesseract?.createWorker) {
      throw new Error("Tesseract non disponible");
    }

    const workerOptions = {
      workerPath: "./lib/tesseract/worker.min.js",
      corePath: "./lib/tesseract/tesseract-core.wasm.js",
      langPath: "./lib/tesseract/lang"
    };

    let worker;
    try {
      worker = await window.Tesseract.createWorker("fra", 1, workerOptions);
    } catch (fraErr) {
      console.error("[CERFA] fra worker failed, fallback eng", fraErr);
      worker = await window.Tesseract.createWorker("eng", 1, workerOptions);
    }

    const result = await worker.recognize(file, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          const base = Math.round((completed / total) * 100);
          const pct = Math.round((m.progress || 0) * (100 / total));
          const totalPct = Math.min(99, base + pct);
          setProgress(totalPct, `OCR ${DOCS[docKey].label}: ${Math.round((m.progress || 0) * 100)}%`);
        }
      }
    });

    await worker.terminate();
    return (result?.data?.text || "").trim();
  } catch (err) {
    console.error("[CERFA] OCR error", err);
    setProgress(Math.round(((completed + 1) / total) * 100), `OCR faible pour ${DOCS[docKey].label}.`);
    return "";
  }
}

function extractFromIdText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const dates = normalized.match(/\b(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/g) || [];

  const lastname = pickAfterKeyword(normalized, ["nom", "surname", "name"]) || pickUppercaseName(normalized);
  const firstname = pickAfterKeyword(normalized, ["prénom", "prenom", "given name", "firstname"]);
  const dob = dates[0] || "";
  const address = pickAfterKeyword(normalized, ["adresse", "address", "domicile"]);

  return { lastname, firstname, dob, address };
}

function extractFromRegistrationText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const dates = normalized.match(/\b(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/g) || [];

  const plate = (normalized.match(/\b[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}\b/i)?.[0] || "")
    .toUpperCase()
    .replace(/\s+/g, "-");
  const vin = normalized.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0] || "";

  const make = pickAfterKeyword(normalized, ["marque", "constructeur"]);
  const model = pickAfterKeyword(normalized, ["modèle", "modele", "type", "version"]);
  const firstRegDate = dates[0] || "";
  const holderName = pickAfterKeyword(normalized, ["titulaire", "nom", "propriétaire", "proprietaire"]);
  const holderAddress = pickAfterKeyword(normalized, ["adresse", "domicile", "address"]);

  return { plate, vin, make, model, firstRegDate, holderName, holderAddress };
}

function pickAfterKeyword(text, keywords) {
  for (const keyword of keywords) {
    const re = new RegExp(`${keyword}\\s*[:\\-]?\\s*([A-Za-zÀ-ÿ0-9' .-]{2,64})`, "i");
    const match = text.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function pickUppercaseName(text) {
  const match = text.match(/\b([A-ZÀ-Ý]{2,}(?:\s+[A-ZÀ-Ý]{2,}){0,2})\b/);
  return match?.[1] || "";
}

function fillFormFromData(data) {
  setField("seller_lastname", data.seller?.lastname || "");
  setField("seller_firstname", data.seller?.firstname || "");
  setField("seller_dob", data.seller?.dob || "");
  setField("seller_address", data.seller?.address || data.vehicle?.holderAddress || "");

  setField("buyer_lastname", data.buyer?.lastname || "");
  setField("buyer_firstname", data.buyer?.firstname || "");
  setField("buyer_dob", data.buyer?.dob || "");
  setField("buyer_address", data.buyer?.address || "");

  setField("vehicle_plate", data.vehicle?.plate || "");
  setField("vehicle_vin", data.vehicle?.vin || "");
  setField("vehicle_make", data.vehicle?.make || "");
  setField("vehicle_model", data.vehicle?.model || "");
  setField("vehicle_first_reg_date", data.vehicle?.firstRegDate || "");

  setField("date", data.date || getTodayFr());
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) {
    console.error("[CERFA] missing field", id);
    return;
  }
  el.value = value;
}

function ensureTodayDate() {
  setField("date", getTodayFr());
}

function getTodayFr() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function setProgress(percent, text) {
  ui.progressEl.value = percent;
  ui.statusEl.textContent = text;
}

function setUiMessage(msg) {
  ui.uiMessageEl.textContent = msg;
}

async function generateSummaryPdf() {
  try {
    const { PDFDocument, StandardFonts } = window.PDFLib || {};
    if (!PDFDocument || !StandardFonts) throw new Error("pdf-lib indisponible");

    const data = Object.fromEntries(new FormData(ui.formEl).entries());
    const lines = [
      "Récapitulatif cession véhicule (MVP local)",
      "",
      `Vendeur: ${data.seller_lastname || ""} ${data.seller_firstname || ""}`,
      `DOB vendeur: ${data.seller_dob || ""}`,
      `Adresse vendeur: ${data.seller_address || ""}`,
      "",
      `Acheteur: ${data.buyer_lastname || ""} ${data.buyer_firstname || ""}`,
      `DOB acheteur: ${data.buyer_dob || ""}`,
      `Adresse acheteur: ${data.buyer_address || ""}`,
      "",
      `Plaque: ${data.vehicle_plate || ""}`,
      `VIN: ${data.vehicle_vin || ""}`,
      `Marque/Modèle: ${data.vehicle_make || ""} ${data.vehicle_model || ""}`,
      `1re immat: ${data.vehicle_first_reg_date || ""}`,
      "",
      `Date cession: ${data.date || ""} ${data.sale_time || ""}`,
      `Lieu: ${data.sale_place || ""}`,
      "",
      "Traitement local uniquement."
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
    const a = document.createElement("a");
    a.href = url;
    a.download = "cerfa-recapitulatif.pdf";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[CERFA] generateSummaryPdf error", err);
    setUiMessage("Impossible de générer le PDF récapitulatif.");
  }
}

async function inspectTemplatePdf() {
  try {
    const { PDFDocument } = window.PDFLib || {};
    if (!PDFDocument) throw new Error("pdf-lib indisponible");

    const response = await fetch("./templates/cerfa_15776_02.pdf");
    if (!response.ok) {
      setUiMessage("Template introuvable: ajoutez ./templates/cerfa_15776_02.pdf");
      return;
    }

    const bytes = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(bytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    if (!fields.length) {
      setUiMessage("Template non remplissable, mode placement XY requis");
      console.log("[CERFA] template has no AcroForm fields");
      return;
    }

    console.log("[CERFA] template fields", fields.map((f) => f.getName()));
    setUiMessage(`Template détecté: ${fields.length} champ(s) trouvés (voir console).`);
  } catch (err) {
    console.error("[CERFA] inspectTemplatePdf error", err);
    setUiMessage("Lecture template impossible (voir console).");
  }
}
