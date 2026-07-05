import Downloader from "@/components/Downloader";

/** FAQ content — rendered visibly AND emitted as FAQPage structured data. */
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is this YouTube downloader free?",
    a: "Yes. It is completely free to use, with no ads, no watermarks and no signup required. Paste a YouTube link, choose a quality, and download.",
  },
  {
    q: "Can I download YouTube videos in 1080p or 4K?",
    a: "Yes. You can pick any resolution the video offers — 720p, 1080p, 1440p, or 4K. Separate video and audio streams are automatically merged into a single MP4 file.",
  },
  {
    q: "How do I convert a YouTube video to MP3?",
    a: "Switch the toggle to Audio, choose MP3 (or M4A) and a bitrate up to 320 kbps, then download. The audio track is extracted without downloading the video.",
  },
  {
    q: "Is it safe and legal to use?",
    a: "The tool is safe — it runs on the open-source yt-dlp project and stores nothing about you. Downloading is intended for personal, offline use; only download content you own or have the right to, as downloading may violate YouTube's Terms of Service.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

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
            YouTube Video Downloader
          </h1>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Download YouTube videos as MP4 in up to 4K, or extract the audio as
          MP3 &mdash; free, fast, and without ads or signup.
        </p>
      </header>

      <Downloader />

      {/* Crawlable content for SEO */}
      <section className="space-y-5" aria-labelledby="faq-heading">
        <h2
          id="faq-heading"
          className="text-lg font-semibold tracking-tight text-neutral-800 dark:text-neutral-100"
        >
          Frequently asked questions
        </h2>
        <div className="space-y-4">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q} className="space-y-1">
              <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {item.q}
              </h3>
              <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </section>

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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </main>
  );
}
