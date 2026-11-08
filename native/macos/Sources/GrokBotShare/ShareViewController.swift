import AppKit
import Foundation
import UniformTypeIdentifiers
import Darwin

@objc(GrokBotShareViewController)
final class ShareViewController: NSViewController {
    private var started = false
    override func loadView() { view = NSView(frame: NSRect(x: 0, y: 0, width: 1, height: 1)); view.alphaValue = 0; preferredContentSize = .zero }
    override func viewDidLoad() {
        super.viewDidLoad()
        guard !started, let context = extensionContext else { return }; started = true
        Task { @MainActor in await receive(context) }
    }
    private func receive(_ context: NSExtensionContext) async {
        var staging: URL?
        var preparing: URL?
        do {
            guard let home = getpwuid(getuid())?.pointee.pw_dir else { throw failure("无法访问本地收件目录。") }
            let root = URL(fileURLWithPath: String(cString: home)).appendingPathComponent("Library/Application Support/Grok Bot Anywhere/ShareInbox", isDirectory: true)
            let bindingURL = Bundle.main.url(forResource: "binding", withExtension: "json")!
            let binding = try JSONSerialization.jsonObject(with: Data(contentsOf: bindingURL)) as? [String: Any] ?? [:]
            let configuration = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("configuration.json"))) as? [String: Any] ?? [:]
            guard let accountID = binding["accountId"] as? String, configuration["accountId"] as? String == accountID,
                  let botID = binding["botId"] as? String,
                  let entry = (configuration["entries"] as? [[String: Any]])?.first(where: { $0["botId"] as? String == botID && $0["accountId"] as? String == accountID }) else { throw failure("此接收单位已关闭或账号已切换，请更新分享菜单。") }
            let id = UUID().uuidString.lowercased(), fileManager = FileManager.default
            let stageRoot = root.appendingPathComponent("Staging", isDirectory: true), readyRoot = root.appendingPathComponent("Ready", isDirectory: true), preparingRoot = root.appendingPathComponent("Preparing", isDirectory: true)
            try fileManager.createDirectory(at: stageRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try fileManager.createDirectory(at: readyRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try fileManager.createDirectory(at: preparingRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let directory = stageRoot.appendingPathComponent(id, isDirectory: true); staging = directory
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let createdAt = Int64(Date().timeIntervalSince1970 * 1000)
            // Tell the app which Bot is about to receive content before the
            // (possibly slow) copy of a large chat log. The composer can open
            // immediately and fill in attachments when the manifest lands.
            let marker = preparingRoot.appendingPathComponent("\(id).json"); preparing = marker
            let markerBody: [String: Any] = ["version": 1, "id": id, "accountId": accountID, "botId": botID, "sessionId": entry["sessionId"] as? String ?? "", "source": "wechat", "createdAt": createdAt, "mode": entry["mode"] as? String ?? "compose", "prefix": entry["prefix"] as? String ?? ""]
            if let data = try? JSONSerialization.data(withJSONObject: markerBody) { try? data.write(to: marker, options: .atomic) }
            launchHost()
            var files: [[String: Any]] = [], texts: [String] = [], title = ""
            for case let item as NSExtensionItem in context.inputItems {
                if title.isEmpty { title = String((item.attributedTitle?.string ?? "").prefix(1000)) }
                if let text = item.attributedContentText?.string, !text.isEmpty { texts.append(text) }
                for provider in item.attachments ?? [] {
                    guard files.count < 100 else { throw failure("一次分享的文件过多。") }
                    // A provider may offer both a document and a text preview.
                    // Prefer the document; a text-only provider still becomes text.
                    let textType = { (identifier: String) in identifier == UTType.plainText.identifier || (UTType(identifier)?.conforms(to: .text) ?? false) }
                    let fileLike = [UTType.zip.identifier, UTType.movie.identifier, UTType.image.identifier].contains { provider.hasItemConformingToTypeIdentifier($0) }
                        || provider.registeredTypeIdentifiers.contains { !textType($0) && $0 != UTType.fileURL.identifier && $0 != UTType.data.identifier }
                    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                        let file = try await loadFileURL(provider, into: directory, index: files.count); files.append(file)
                    } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), !fileLike {
                        let value = try await loadText(provider); if !value.isEmpty { texts.append(value) }
                    } else {
                        // WeChat uses different UTIs for files, images and chat
                        // records. Prefer the provider's specific UTI (so a Word
                        // document keeps its .docx name and type), then the known
                        // file-ish types, and only then public.data. Nothing is
                        // silently dropped before the app sees it.
                        var types = provider.registeredTypeIdentifiers.filter { $0 != UTType.fileURL.identifier && $0 != UTType.plainText.identifier && $0 != UTType.data.identifier }
                        for type in [UTType.zip.identifier, UTType.movie.identifier, UTType.image.identifier] where provider.hasItemConformingToTypeIdentifier(type) && !types.contains(type) { types.append(type) }
                        if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier), !types.contains(UTType.data.identifier) { types.append(UTType.data.identifier) }
                        guard !types.isEmpty else { throw failure("此分享内容暂不支持，请转发 ZIP、文档、文本或媒体文件。") }
                        var loaded: [String: Any]?
                        var lastError: Error?
                        for type in types {
                            do { loaded = try await loadRepresentation(provider, type: type, into: directory, index: files.count); break }
                            catch { lastError = error }
                        }
                        if loaded == nil {
                            for type in types {
                                do { loaded = try await loadDataRepresentation(provider, type: type, into: directory, index: files.count); break }
                                catch { lastError = error }
                            }
                        }
                        guard let loaded else { throw lastError ?? failure("无法读取分享文件。") }
                        files.append(loaded)
                    }
                }
            }
            let text = texts.joined(separator: "\n\n")
            guard !files.isEmpty || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.count <= 2_000_000 else { throw failure("没有可接收的内容，或文字过长。") }
            let manifest: [String: Any] = ["version": 1, "id": id, "accountId": accountID, "botId": botID, "sessionId": entry["sessionId"] as? String ?? "", "source": "wechat", "createdAt": Int64(Date().timeIntervalSince1970 * 1000), "mode": entry["mode"] as? String ?? "compose", "prefix": entry["prefix"] as? String ?? "", "title": title, "text": text, "files": files]
            let manifestURL = directory.appendingPathComponent("manifest.json")
            try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL, options: .atomic)
            try sync(manifestURL)
            try fileManager.moveItem(at: directory, to: readyRoot.appendingPathComponent(id)); staging = nil
            if let preparing { try? fileManager.removeItem(at: preparing) }
            launchHost()
            context.completeRequest(returningItems: nil, completionHandler: nil)
        } catch {
            if let preparing { try? FileManager.default.removeItem(at: preparing) }
            if let staging { try? FileManager.default.removeItem(at: staging) }
            context.cancelRequest(withError: error)
        }
    }
    private func loadText(_ provider: NSItemProvider) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, error in
                if let error { continuation.resume(throwing: error) }
                else if let text = item as? String { continuation.resume(returning: text) }
                else if let data = item as? Data, let text = String(data: data, encoding: .utf8) { continuation.resume(returning: text) }
                else { continuation.resume(throwing: Self.failureStatic("无法读取分享文字。")) }
            }
        }
    }
    private func loadFileURL(_ provider: NSItemProvider, into directory: URL, index: Int) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                do {
                    if let error { throw error }
                    let url = (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
                    guard let url, url.isFileURL else { throw Self.failureStatic("无法读取分享文件。") }
                    continuation.resume(returning: try Self.copy(url, into: directory, index: index, suggestedName: nil, typeIdentifier: nil))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private func loadRepresentation(_ provider: NSItemProvider, type: String, into directory: URL, index: Int) async throws -> [String: Any] {
        let name = provider.suggestedName
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                do {
                    if let error { throw error }; guard let url else { throw Self.failureStatic("无法读取分享文件。") }
                    continuation.resume(returning: try Self.copy(url, into: directory, index: index, suggestedName: name, typeIdentifier: type))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private func loadDataRepresentation(_ provider: NSItemProvider, type: String, into directory: URL, index: Int) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: type) { data, error in
                do {
                    if let error { throw error }
                    guard let data, !data.isEmpty, data.count <= 64 * 1024 * 1024 else { throw Self.failureStatic("无法读取分享文件。") }
                    let fallback = provider.suggestedName ?? "attachment"
                    var name = URL(fileURLWithPath: fallback).lastPathComponent
                    if name.isEmpty || name == "." || name == ".." { name = "attachment" }
                    if URL(fileURLWithPath: name).pathExtension.isEmpty, let ext = UTType(type)?.preferredFilenameExtension { name += ".\(ext)" }
                    let relativePath = "\(index)-\(name)", target = directory.appendingPathComponent(relativePath)
                    try data.write(to: target, options: .atomic)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
                    try Self.sync(target)
                    continuation.resume(returning: ["relativePath": relativePath, "name": name, "bytes": data.count])
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    private static func copy(_ source: URL, into directory: URL, index: Int, suggestedName: String?, typeIdentifier: String?) throws -> [String: Any] {
        let access = source.startAccessingSecurityScopedResource(); defer { if access { source.stopAccessingSecurityScopedResource() } }
        let info = try source.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard info.isRegularFile == true, (info.fileSize ?? 0) > 0 else { throw failureStatic("请选择非空普通文件。") }
        let fallback = source.lastPathComponent.isEmpty ? "attachment" : source.lastPathComponent
        var name = URL(fileURLWithPath: suggestedName ?? fallback).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { name = fallback }
        // WeChat sometimes hands over a temporary file without a useful suffix;
        // recover the extension from the UTType so .docx and friends stay typed.
        if URL(fileURLWithPath: name).pathExtension.isEmpty, let typeIdentifier, let ext = UTType(typeIdentifier)?.preferredFilenameExtension {
            name += ".\(ext)"
        }
        let relativePath = "\(index)-\(name)", target = directory.appendingPathComponent(relativePath)
        try FileManager.default.copyItem(at: source, to: target)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
        try sync(target)
        return ["relativePath": relativePath, "name": name, "bytes": info.fileSize ?? 0]
    }
    private static func sync(_ url: URL) throws { let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }; try handle.synchronize() }
    private func sync(_ url: URL) throws { try Self.sync(url) }
    private static func failureStatic(_ text: String) -> NSError { NSError(domain: "dev.ronglecat.grokbotanywhere.share", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private func failure(_ text: String) -> NSError { Self.failureStatic(text) }
    private func launchHost() {
        let host = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard host.pathExtension == "app" else { return }
        let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = false; configuration.addsToRecentItems = false
        NSWorkspace.shared.openApplication(at: host, configuration: configuration)
    }
}
