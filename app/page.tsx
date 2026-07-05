import Downloader from "@/components/Downloader";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          YouTube Downloader
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Paste a YouTube link, pick a quality, and download the video or audio.
        </p>
      </header>

      <Downloader />

      <footer className="mt-auto pt-8 text-xs text-neutral-400 dark:text-neutral-500">
        For personal, offline use only. Downloading content may violate
        YouTube&rsquo;s Terms of Service &mdash; you are responsible for how you
        use this tool.
      </footer>
    </main>
  );
}
