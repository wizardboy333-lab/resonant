import Link from "next/link";

export default function Header() {
  return (
    <header className="relative z-20 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-ember-400 to-viola-500 shadow-glow">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-ink-950"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
            </svg>
          </span>
          <div className="leading-tight">
            <span className="block font-display text-lg tracking-tight text-mist-100 group-hover:text-white">
              Resonant
            </span>
            <span className="block text-[10px] uppercase tracking-[0.22em] text-mist-400">
              YouTube → Audio
            </span>
          </div>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3 text-sm">
          <Link
            href="/convert"
            className="rounded-full px-3 py-1.5 text-mist-300 transition hover:bg-white/5 hover:text-white"
          >
            Converter
          </Link>
          <a
            href="/#ethics"
            className="hidden rounded-full px-3 py-1.5 text-mist-400 transition hover:text-mist-200 sm:inline"
          >
            Rights
          </a>
        </nav>
      </div>
    </header>
  );
}
