import SwiftUI

/// Shell app that hosts the Share Extension and can deep-link into the web converter.
struct ContentView: View {
    @State private var pendingURL: String = ""
    @Environment(\.openURL) private var openURL

    private var webBase: String {
        (Bundle.main.object(forInfoDictionaryKey: "ResonantWebBaseURL") as? String)
            ?? "https://regards-threatening-locale-desktop.trycloudflare.com"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Resonant")
                        .font(.largeTitle.weight(.bold))
                    Text("Share a YouTube link from Safari or the YouTube app into the Resonant Share Extension. It opens the web converter with your URL.")
                        .foregroundStyle(.secondary)

                    GroupBox("How to use") {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Share a youtube.com or youtu.be URL", systemImage: "square.and.arrow.up")
                            Label("Choose Resonant in the share sheet", systemImage: "app.badge")
                            Label("Converter opens with ?url= prefilled", systemImage: "link")
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                    }

                    GroupBox("Open converter") {
                        TextField("Paste YouTube URL", text: $pendingURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                        Button("Open in Resonant Web") {
                            openConverter(with: pendingURL)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(pendingURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    Text("Only download content you have rights to. YouTube ToS may restrict downloading. Public watch URLs only.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("Resonant")
            .onOpenURL { url in
                // resonant://convert?url=...
                if let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let item = components.queryItems?.first(where: { $0.name == "url" }),
                   let value = item.value {
                    pendingURL = value
                    openConverter(with: value)
                }
            }
        }
    }

    private func openConverter(with raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              var components = URLComponents(string: "\(webBase)/convert") else { return }
        components.queryItems = [URLQueryItem(name: "url", value: trimmed)]
        if let dest = components.url {
            openURL(dest)
        }
    }
}

#Preview {
    ContentView()
}
