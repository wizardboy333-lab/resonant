export default function EthicsNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-xs text-mist-400 leading-relaxed">
        Only download content you have rights to. YouTube ToS may restrict downloading.
        Public videos & playlists only — no credentials or DRM bypass.
      </p>
    );
  }
  return (
    <aside
      className="rounded-2xl border border-ember-500/20 bg-ember-500/5 px-4 py-3 sm:px-5 sm:py-4"
      role="note"
    >
      <p className="text-sm text-mist-200 leading-relaxed">
        <span className="font-semibold text-ember-300">Rights &amp; ToS.</span>{" "}
        Only download content you have rights to. YouTube&apos;s Terms of Service may
        restrict downloading. This tool accepts public videos and playlists only — no credential
        scraping, no DRM bypass.
      </p>
    </aside>
  );
}
