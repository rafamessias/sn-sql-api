const AUTHOR = "Rafael Messias";
const LINKEDIN_URL = "https://www.linkedin.com/in/rafaelmessias/";
const LICENSE = "MIT";

export const Footer = () => (
  <footer class="mt-auto shrink-0 border-t border-border bg-bg">
    <div class="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 px-6 py-2 font-mono text-[11px] text-subtle">
      <span>
        Made by{" "}
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {AUTHOR}
        </a>
        {" · "}
        <a href="/about" class="hover:text-text">
          /about
        </a>
      </span>
      <span>
        Licensed under{" "}
        <span class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text">
          {LICENSE}
        </span>
      </span>
    </div>
  </footer>
);
