// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "sd-swift",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(path: "../ml-stable-diffusion")
    ],
    targets: [
        .executableTarget(
            name: "sd-swift",
            dependencies: [
                .product(name: "StableDiffusion", package: "ml-stable-diffusion")
            ],
            path: "Sources/sd-swift"
        )
    ]
)
