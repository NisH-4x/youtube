import Downloader from "@/components/Downloader";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-12 sm:py-20">
      <header className="space-y-3">
        <div className="inline-flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M12 4c-3.2 0-5.6.2-7 .5-.9.2-1.6.9-1.8 1.8C3 7.6 3 9.4 3 12s0 4.4.2 5.7c.2.9.9 1.6 1.8 1.8 1.4.3 3.8.5 7 .5s5.6-.2 7-.5c.9-.2 1.6-.9 1.8-1.8.2-1.3.2-3.1.2-5.7s0-4.4-.2-5.7c-.2-.9-.9-1.6-1.8-1.8C17.6 4.2 15.2 4 12 4Zm-2 4.5 6 3.5-6 3.5v-7Z" />
            </svg>
          </span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            YouTube Downloader
          </h1>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Paste a link, pick a quality, and download the video or audio.
        </p>
      </header>

      <Downloader />

      <footer className="mt-auto space-y-3 border-t border-neutral-200 pt-6 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        <p>
          For personal, offline use only. Downloading content may violate
          YouTube&rsquo;s Terms of Service &mdash; you are responsible for how
          you use this tool.
        </p>
        <p>
          Built by{" "}
          <a
            href="https://nishx.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-red-600 underline-offset-2 transition hover:underline dark:text-red-400"
          >
            nishx
          </a>
        </p>
      </footer>
    </main>
  );
}
