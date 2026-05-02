export async function analyzeImageFile(file, { mode = "local" } = {}) {
  if (!file) {
    return {
      available: false,
      text: "",
      message: "No image was selected."
    };
  }

  if (window.location.protocol === "file:") {
    return {
      available: false,
      text: "",
      message:
        "Image OCR needs the local SightBridge server. Open http://127.0.0.1:5173/public/ instead of the file URL."
    };
  }

  try {
    const response = mode === "cloud" ? await analyzeCloud(file) : await analyzeLocal(file);
    const payload = await response.json();

    if (!response.ok) {
      return {
        available: false,
        text: "",
        message: payload.message ?? "Image OCR failed."
      };
    }

    if (!payload.text) {
      return {
        available: true,
        text: "",
        message:
          "Processed locally with macOS Vision OCR, but no readable text was found. Contextual image classification is still a future step."
      };
    }

    return {
      available: true,
      text: payload.text,
      message: payload.message ?? "Processed locally with OCR.",
      cloudDecision: payload.decision ?? null
    };
  } catch {
    return {
      available: false,
      text: "",
      message:
        "Image analysis could not reach the local SightBridge server. Start it with python3 scripts/server.py."
    };
  }
}

async function analyzeLocal(file) {
  const formData = new FormData();
  formData.append("image", file);

  return fetch("/api/analyze-image", {
    method: "POST",
    body: formData
  });
}

async function analyzeCloud(file) {
  const dataUrl = await fileToDataUrl(file);

  return fetch("/api/analyze-image-cloud", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image: {
        name: file.name,
        type: file.type || "image/jpeg",
        dataUrl
      }
    })
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
