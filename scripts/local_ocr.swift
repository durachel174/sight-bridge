import Foundation
import Vision
import ImageIO

struct OCRResult: Encodable {
    let text: String
    let observations: [String]
}

func fail(_ message: String) -> Never {
    let payload = ["error": message]
    let data = try! JSONSerialization.data(withJSONObject: payload, options: [])
    FileHandle.standardOutput.write(data)
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("Usage: swift scripts/local_ocr.swift /path/to/image")
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("Could not read image.")
}

var recognized: [String] = []
let request = VNRecognizeTextRequest { request, error in
    if let error {
        fail(error.localizedDescription)
    }

    let observations = request.results as? [VNRecognizedTextObservation] ?? []
    recognized = observations.compactMap { observation in
        observation.topCandidates(1).first?.string
    }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: image, options: [:])

do {
    try handler.perform([request])
} catch {
    fail(error.localizedDescription)
}

let result = OCRResult(text: recognized.joined(separator: "\n"), observations: recognized)
let output = try JSONEncoder().encode(result)
FileHandle.standardOutput.write(output)
