from __future__ import annotations

import cgi
import base64
import json
import os
import subprocess
import tempfile
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OCR_SCRIPT = ROOT / "scripts" / "local_ocr.swift"


class SightBridgeHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path == "/api/analyze-image-cloud":
            self.handle_cloud_image()
            return

        if self.path != "/api/analyze-image":
            self.send_error(404, "Not found")
            return

        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            self._json_response(400, {"available": False, "message": "Expected multipart image upload."})
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        image_field = form["image"] if "image" in form else None

        if image_field is None or not getattr(image_field, "file", None):
            self._json_response(400, {"available": False, "message": "No image file was uploaded."})
            return

        suffix = Path(image_field.filename or "upload.jpg").suffix or ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as upload:
            upload.write(image_field.file.read())
            upload_path = upload.name

        enhanced_path = None
        try:
            enhanced_path = create_enhanced_copy(upload_path)
            ocr_payloads = [
                run_ocr(upload_path),
                run_ocr(enhanced_path),
            ]
        except RuntimeError as error:
            self._json_response(500, {"available": False, "message": str(error)})
            return
        finally:
            for path in [upload_path, enhanced_path]:
                if not path:
                    continue
                try:
                    os.unlink(path)
                except OSError:
                    pass

        observations = merge_observations(ocr_payloads)
        text = "\n".join(observations).strip()
        self._json_response(
            200,
            {
                "available": True,
                "text": text,
                "message": "Processed locally with macOS Vision OCR, including an enhanced OCR pass.",
                "observations": observations,
            },
        )

    def do_GET(self):
        if self.path == "/api/config":
            self._json_response(
                200,
                {
                    "cloudVisionAvailable": bool(os.environ.get("OPENAI_API_KEY")),
                    "localOcrAvailable": True,
                    "cloudVisionProvider": "OpenAI Responses API",
                },
            )
            return
        super().do_GET()

    def handle_cloud_image(self):
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self._json_response(
                503,
                {
                    "available": False,
                    "message": "Cloud vision is not configured. Set OPENAI_API_KEY before starting the server.",
                },
            )
            return

        if self.headers.get("Content-Type", "").startswith("application/json"):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                image = body.get("image", {})
                payload = call_openai_vision_data_url(
                    api_key,
                    image.get("dataUrl", ""),
                    image.get("name", "upload.jpg"),
                )
            except (json.JSONDecodeError, RuntimeError) as error:
                self._json_response(502, {"available": False, "message": str(error)})
                return
        else:
            upload = self._read_image_upload()
            if not upload:
                return

            upload_path, filename = upload
            try:
                payload = call_openai_vision(api_key, upload_path, filename)
            except RuntimeError as error:
                self._json_response(502, {"available": False, "message": str(error)})
                return
            finally:
                try:
                    os.unlink(upload_path)
                except OSError:
                    pass

        self._json_response(
            200,
            {
                "available": True,
                "text": payload.get("evidence", ""),
                "message": "Processed with OpenAI cloud vision after user confirmation.",
                "decision": payload,
            },
        )

    def _read_image_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            self._json_response(400, {"available": False, "message": "Expected multipart image upload."})
            return None

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        image_field = form["image"] if "image" in form else None

        if image_field is None or not getattr(image_field, "file", None):
            self._json_response(400, {"available": False, "message": "No image file was uploaded."})
            return None

        suffix = Path(image_field.filename or "upload.jpg").suffix or ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as upload:
            upload.write(image_field.file.read())
            return upload.name, image_field.filename or "upload.jpg"

    def _json_response(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    os.chdir(ROOT)
    port = int(os.environ.get("PORT", "5173"))
    server = ThreadingHTTPServer(("127.0.0.1", port), SightBridgeHandler)
    print(f"SightBridge running at http://127.0.0.1:{port}/public/")
    server.serve_forever()


def create_enhanced_copy(image_path):
    output = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
    output.close()

    image = Image.open(image_path).convert("RGB")
    image = image.resize((image.width * 4, image.height * 4), Image.Resampling.LANCZOS)
    image = ImageEnhance.Contrast(image).enhance(1.8)
    image = ImageEnhance.Sharpness(image).enhance(2.2)
    image = image.filter(ImageFilter.UnsharpMask(radius=1.4, percent=180, threshold=2))
    image.save(output.name)
    return output.name


def run_ocr(image_path):
    completed = subprocess.run(
        ["swift", str(OCR_SCRIPT), image_path],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )

    if completed.returncode != 0:
        message = "Local OCR failed."
        try:
            error_payload = json.loads(completed.stdout)
            message = error_payload.get("error", message)
        except json.JSONDecodeError:
            if completed.stderr.strip():
                message = completed.stderr.strip()
        raise RuntimeError(message)

    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Local OCR returned invalid JSON.") from error


def merge_observations(payloads):
    seen = set()
    merged = []
    for payload in payloads:
        observations = payload.get("observations", [])
        if not observations and payload.get("text"):
            observations = payload["text"].splitlines()
        for observation in observations:
            cleaned = observation.strip()
            key = cleaned.casefold()
            if cleaned and key not in seen:
                seen.add(key)
                merged.append(cleaned)
    return merged


def call_openai_vision(api_key, image_path, filename):
    mime_type = mime_type_for(filename)
    with open(image_path, "rb") as image_file:
        image_data = base64.b64encode(image_file.read()).decode("utf-8")
    return call_openai_vision_data_url(api_key, f"data:{mime_type};base64,{image_data}", filename)


def call_openai_vision_data_url(api_key, data_url, filename):
    if not data_url.startswith("data:image/"):
        raise RuntimeError("Expected a base64 image data URL.")

    request_payload = {
        "model": os.environ.get("OPENAI_VISION_MODEL", "gpt-4.1-mini"),
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Analyze this image for privacy disclosure risk before sharing a camera feed. "
                            "Return only JSON with keys: severity (low, medium, high, uncertain), "
                            "category (financial, medical, identity, address, screen, personal, public, none), "
                            "disclosure_message, reasoning, evidence. Keep evidence brief and redact full account, "
                            "card, ID, or medical record numbers."
                        ),
                    },
                    {
                        "type": "input_image",
                        "image_url": data_url,
                        "detail": "high",
                    },
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "disclosure_decision",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "severity": {"type": "string"},
                        "category": {"type": "string"},
                        "disclosure_message": {"type": "string"},
                        "reasoning": {"type": "string"},
                        "evidence": {"type": "string"},
                    },
                    "required": ["severity", "category", "disclosure_message", "reasoning", "evidence"],
                },
            }
        },
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI vision request failed: {details}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"OpenAI vision request failed: {error.reason}") from error

    output_text = response_payload.get("output_text")
    if not output_text:
        output_text = extract_response_text(response_payload)

    try:
        return json.loads(output_text)
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("OpenAI vision returned an unreadable decision.") from error


def extract_response_text(response_payload):
    chunks = []
    for item in response_payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(content["text"])
    return "\n".join(chunks)


def mime_type_for(filename):
    suffix = Path(filename).suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    return "image/jpeg"


if __name__ == "__main__":
    main()
