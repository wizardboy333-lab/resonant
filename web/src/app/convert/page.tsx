import Converter from "../../components/Converter";

export const metadata = {
  title: "Converter — Resonant",
};

export default function ConvertPage({
  searchParams,
}: {
  searchParams: { url?: string };
}) {
  const initialUrl = typeof searchParams.url === "string" ? searchParams.url : "";
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8">
        <h1 className="font-display text-3xl tracking-tight text-mist-100 sm:text-4xl">
          Converter
        </h1>
        <p className="mt-2 text-mist-400">
          Paste a public YouTube video or playlist URL, or open this page with{" "}
          <code className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-xs text-ember-200">
            ?url=
          </code>
        </p>
      </div>
      <Converter initialUrl={initialUrl} />
    </div>
  );
}
