import EthicsNotice from "./EthicsNotice";

export default function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-white/5 bg-ink-950/80">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6">
        <EthicsNotice compact />
        <p className="text-xs text-mist-500">
          Resonant · local yt-dlp + ffmpeg · not affiliated with YouTube or Google
        </p>
      </div>
    </footer>
  );
}
