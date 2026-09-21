# Resonant iOS — App + Share Extension

Unsigned Xcode source for sharing YouTube URLs into the Resonant web converter.

## Bundle IDs

| Target | Bundle ID |
|--------|-----------|
| Main app (`Resonant`) | `com.resonant.youtubeaudio` |
| Share Extension | `com.resonant.youtubeaudio.share` |

Change both (and App Group / team) to your Apple Developer identifiers before signing.

## Activation rules

Share Extension `Info-Code.plist` activates when the share sheet includes:

- **Web URL** (`NSExtensionActivationSupportsWebURLWithMaxCount` = 1) — Safari / Chrome shares
- **Plain text** (`NSExtensionActivationSupportsText`) — scans for `youtube.com` / `youtu.be` links

The extension extracts the first matching YouTube URL and opens:

```
{ResonantWebBaseURL}/convert?url={encodedYouTubeURL}
```

Default `ResonantWebBaseURL` is `http://127.0.0.1:3000` (set in both Info plists). For a device on your LAN, point it at your machine IP or deployed HTTPS origin.

Optional deep link into the host app: `resonant://convert?url=…`

## Xcode setup

1. Open `YouTubeAudio.xcodeproj` on a Mac with Xcode 15+.
2. Select the **YouTubeAudio** target → Signing & Capabilities → choose your Team.
3. Select **ShareExtension** → same Team; ensure bundle ID is `…share` under the app ID.
4. Update `ResonantWebBaseURL` in both Info plists to your running web app.
5. (Optional) Add URL Type `resonant` on the main app for deep links.
6. Run on a physical device (Share Extensions are awkward in Simulator for Safari shares).
7. First run: Settings → enable the Resonant share extension under Edit Actions if needed.

## Project layout

```
ios/
  YouTubeAudio.xcodeproj/
  YouTubeAudio/YouTubeAudio/   # SwiftUI shell app
  ShareExtension/ShareExtension/
    ShareViewController.swift
    Info-Code.plist            # used by the Xcode target
    Info.plist                 # storyboard-style reference copy
```

## Ethics

Only share / convert content you have rights to. YouTube ToS may restrict downloading. Public watch URLs only — no credentials, no DRM bypass.
