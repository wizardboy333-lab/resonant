import Link from "next/link";
import EthicsNotice from "../components/EthicsNotice";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900/50 px-6 py-14 shadow-card sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-ember-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-viola-500/15 blur-3xl" />

        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-ember-300">
          Local · yt-dlp · ffmpeg
        </p>
        <h1 className="max-w-2xl font-display text-4xl leading-[1.1] tracking-tight text-mist-100 text-balance sm:text-6xl">
          Pull the sound.
          <span className="block text-ember-300/90">Leave the noise.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-mist-300 sm:text-lg">
          Paste a public YouTube URL. Preview title, channel, and thumbnail. Choose
          best / 256 / 128 kbps. Download clean audio — m4a, opus, or mp3.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/convert"
            className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-ember-500 to-ember-600 px-6 py-3.5 text-sm font-semibold text-ink-950 shadow-glow transition hover:from-ember-400 hover:to-ember-500"
          >
            Open converter
          </Link>
          <Link
            href="/convert?url=https://www.youtube.com/watch?v=jNQXAC9IVRw"
            className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-medium text-mist-200 transition hover:bg-white/10"
          >
            Try a sample URL
          </Link>
        </div>
      </section>

      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Metadata first",
            body: "See title, channel, duration, and thumbnail before you commit to a download.",
          },
          {
            title: "Quality you pick",
            body: "Best available, 256 kbps AAC, or portable 128 kbps MP3 — when ffmpeg can deliver.",
          },
          {
            title: "Share from iOS",
            body: "Share Extension catches youtube.com / youtu.be links and opens the converter.",
          },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-3xl border border-white/8 bg-ink-800/40 p-6"
          >
            <h2 className="font-display text-lg text-mist-100">{card.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-mist-400">{card.body}</p>
          </div>
        ))}
      </section>

      <div id="ethics" className="mt-10 scroll-mt-24">
        <EthicsNotice />
      </div>
    </div>
  );
}
