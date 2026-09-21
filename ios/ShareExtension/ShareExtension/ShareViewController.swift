import UIKit
import UniformTypeIdentifiers
import MobileCoreServices

/// Share Extension: activates for shared URLs/text, extracts YouTube links,
/// and opens the Resonant web converter (or posts to the API base).
final class ShareViewController: UIViewController {

    private let statusLabel = UILabel()
    private let openButton = UIButton(type: .system)

    private var extractedURL: URL?

    private var webBase: String {
        (Bundle.main.object(forInfoDictionaryKey: "ResonantWebBaseURL") as? String)
            ?? "https://regards-threatening-locale-desktop.trycloudflare.com"
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.03, green: 0.02, blue: 0.04, alpha: 1)

        statusLabel.textColor = .white
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.text = "Looking for a YouTube link…"
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        openButton.setTitle("Open in Resonant", for: .normal)
        openButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        openButton.isEnabled = false
        openButton.addTarget(self, action: #selector(openConverter), for: .touchUpInside)
        openButton.translatesAutoresizingMaskIntoConstraints = false

        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(cancelShare), for: .touchUpInside)
        cancel.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(statusLabel)
        view.addSubview(openButton)
        view.addSubview(cancel)

        NSLayoutConstraint.activate([
            statusLabel.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -40),
            openButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 24),
            openButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.topAnchor.constraint(equalTo: openButton.bottomAnchor, constant: 16),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])

        extractYouTubeURL()
    }

    private func extractYouTubeURL() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            statusLabel.text = "Nothing to share."
            return
        }

        let providers = items.flatMap { $0.attachments ?? [] }
        let urlType = UTType.url.identifier
        let textType = UTType.plainText.identifier

        let group = DispatchGroup()
        var found: URL?

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(urlType) {
                group.enter()
                provider.loadItem(forTypeIdentifier: urlType, options: nil) { item, _ in
                    defer { group.leave() }
                    if let url = item as? URL, Self.isYouTube(url) {
                        found = url
                    } else if let str = item as? String, let url = URL(string: str), Self.isYouTube(url) {
                        found = url
                    }
                }
            } else if provider.hasItemConformingToTypeIdentifier(textType) {
                group.enter()
                provider.loadItem(forTypeIdentifier: textType, options: nil) { item, _ in
                    defer { group.leave() }
                    if let str = item as? String, let url = Self.firstYouTube(in: str) {
                        found = url
                    }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            if let url = found {
                self.extractedURL = url
                self.statusLabel.text = "Found:\n\(url.absoluteString)"
                self.openButton.isEnabled = true
                // Auto-open for a snappy share flow
                self.openConverter()
            } else {
                self.statusLabel.text = "No youtube.com / youtu.be URL found in this share."
            }
        }
    }

    static func isYouTube(_ url: URL) -> Bool {
        let host = (url.host ?? "").lowercased()
        return host == "youtu.be"
            || host == "www.youtu.be"
            || host.hasSuffix("youtube.com")
    }

    static func firstYouTube(in text: String) -> URL? {
        let pattern = #"https?://(?:www\.)?(?:youtube\.com|youtu\.be)/[^\s]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              let swiftRange = Range(match.range, in: text) else { return nil }
        return URL(string: String(text[swiftRange])).flatMap { isYouTube($0) ? $0 : nil }
    }

    @objc private func openConverter() {
        guard let yt = extractedURL else { return }
        var components = URLComponents(string: "\(webBase)/convert")
        components?.queryItems = [URLQueryItem(name: "url", value: yt.absoluteString)]

        // Also support resonant:// deep link into the host app
        var appLink = URLComponents(string: "resonant://convert")
        appLink?.queryItems = [URLQueryItem(name: "url", value: yt.absoluteString)]

        if let web = components?.url {
            openURL(web)
        } else if let app = appLink?.url {
            openURL(app)
        }
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    /// Share extensions cannot call UIApplication.shared.open directly in all contexts;
    /// use the responder chain / extensionContext open API.
    private func openURL(_ url: URL) {
        var responder: UIResponder? = self
        while let r = responder {
            if let application = r as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = r.next
        }
        // Fallback: selector openURL: used historically by share extensions
        let selector = sel_registerName("openURL:")
        var resp: UIResponder? = self
        while let r = resp {
            if r.responds(to: selector) {
                r.perform(selector, with: url)
                return
            }
            resp = r.next
        }
        // Last resort: hand URL back via resonant deep link scheme documentation
        extensionContext?.open(url, completionHandler: nil)
    }

    @objc private func cancelShare() {
        extensionContext?.cancelRequest(withError: NSError(domain: "ResonantShare", code: 0))
    }
}
