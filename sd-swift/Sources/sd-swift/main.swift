import CoreGraphics
import CoreML
import Foundation
import ImageIO
import StableDiffusion
import UniformTypeIdentifiers

// MARK: - Argument parsing

var modelDir = ""
var prompt = ""
var negativePrompt = ""
var outputPath = ""
var steps = 15
var seed: Int = -1
var cfgScale: Float = 7.5
var scheduler = "dpm"
var compileOnly = false

var argv = Array(CommandLine.arguments.dropFirst())
var i = 0
while i < argv.count {
    let flag = argv[i]; i += 1
    switch flag {
    case "--compile-only":
        compileOnly = true
    default:
        guard i < argv.count else { break }
        let val = argv[i]; i += 1
        switch flag {
        case "--model-dir":     modelDir = val
        case "--prompt":        prompt = val
        case "--negative-prompt": negativePrompt = val
        case "--output":        outputPath = val
        case "--steps":         steps = Int(val) ?? 15
        case "--seed":          seed = Int(val) ?? -1
        case "--cfg-scale":     cfgScale = Float(val) ?? 7.5
        case "--scheduler":     scheduler = val
        default: break
        }
    }
}

// MARK: - Model compilation helper

func ensureCompiled(name: String, dir: URL) throws {
    let compiledURL = dir.appending(path: "\(name).mlmodelc")
    let packageURL = dir.appending(path: "\(name).mlpackage")
    if FileManager.default.fileExists(atPath: compiledURL.path) {
        fputs("[sd-swift] \(name).mlmodelc already compiled\n", stderr)
        return
    }
    guard FileManager.default.fileExists(atPath: packageURL.path) else {
        throw NSError(domain: "MoodMusic", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "\(name).mlpackage not found"])
    }
    fputs("[sd-swift] compiling \(name)…\n", stderr)
    let tmpURL = try MLModel.compileModel(at: packageURL)
    // Move compiled bundle from temp location to the model directory
    if FileManager.default.fileExists(atPath: compiledURL.path) {
        try FileManager.default.removeItem(at: compiledURL)
    }
    try FileManager.default.moveItem(at: tmpURL, to: compiledURL)
    fputs("[sd-swift] compiled \(name)\n", stderr)
}

// MARK: - Compile-only mode

if compileOnly {
    guard !modelDir.isEmpty else {
        fputs("Usage: sd-swift --model-dir <path> --compile-only\n", stderr)
        exit(1)
    }
    let modelURL = URL(fileURLWithPath: modelDir, isDirectory: true)
    do {
        for name in ["TextEncoder", "UnetChunk1", "UnetChunk2", "VAEDecoder"] {
            try ensureCompiled(name: name, dir: modelURL)
        }
        fputs("[sd-swift] all models ready\n", stderr)
        exit(0)
    } catch {
        fputs("[sd-swift] compile ERROR: \(error)\n", stderr)
        exit(1)
    }
}

guard !modelDir.isEmpty, !prompt.isEmpty, !outputPath.isEmpty else {
    fputs("Usage: sd-swift --model-dir <path> --prompt <text> --output <path.png> [--negative-prompt <text>] [--steps N] [--seed N] [--cfg-scale F]\n", stderr)
    exit(1)
}

let resolvedSeed = seed < 0 ? UInt32.random(in: 0 ... UInt32.max) : UInt32(seed)

fputs("[sd-swift] model:  \(modelDir)\n", stderr)
fputs("[sd-swift] prompt: \(prompt)\n", stderr)
fputs("[sd-swift] steps:  \(steps)  seed: \(resolvedSeed)\n", stderr)

// MARK: - Pipeline

do {
    let modelURL = URL(fileURLWithPath: modelDir, isDirectory: true)

    // Ensure all models are compiled (no-op if already done)
    for name in ["TextEncoder", "UnetChunk1", "UnetChunk2", "VAEDecoder"] {
        try ensureCompiled(name: name, dir: modelURL)
    }

    let config = MLModelConfiguration()
    config.computeUnits = .all  // ANE + GPU + CPU

    let pipeline = try StableDiffusionPipeline(
        resourcesAt: modelURL,
        controlNet: [],
        configuration: config,
        disableSafety: true,
        reduceMemory: false
    )

    fputs("[sd-swift] loading model resources…\n", stderr)
    try pipeline.loadResources()
    fputs("[sd-swift] generating image…\n", stderr)

    var cfg = StableDiffusionPipeline.Configuration(prompt: prompt)
    cfg.negativePrompt = negativePrompt
    cfg.stepCount = steps
    cfg.seed = resolvedSeed
    cfg.guidanceScale = cfgScale
    cfg.schedulerType = scheduler == "pndm" ? .pndmScheduler : .dpmSolverMultistepScheduler

    let images = try pipeline.generateImages(configuration: cfg) { progress in
        fputs("[sd-swift] step \(progress.step)/\(progress.stepCount)\n", stderr)
        return true  // returning false would cancel generation
    }

    guard let cgImage = images.first ?? nil else {
        fputs("[sd-swift] ERROR: no image produced\n", stderr)
        exit(1)
    }

    // Write PNG
    let outURL = URL(fileURLWithPath: outputPath)
    guard let dest = CGImageDestinationCreateWithURL(
        outURL as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        fputs("[sd-swift] ERROR: could not create image destination at \(outputPath)\n", stderr)
        exit(1)
    }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else {
        fputs("[sd-swift] ERROR: failed to write PNG\n", stderr)
        exit(1)
    }

    fputs("[sd-swift] saved \(outputPath)\n", stderr)
} catch {
    fputs("[sd-swift] ERROR: \(error)\n", stderr)
    exit(1)
}
