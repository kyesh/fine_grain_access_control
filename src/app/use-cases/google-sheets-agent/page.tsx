import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata = {
  title: "Let Claude Update Google Sheets Safely | fgac.ai",
  description:
    "Give Claude and other AI agents read or read-write access to specific Google Sheets — update spreadsheets, append rows, log data — without exposing your whole Drive.",
};

/* SEO landing page (connector-growth Phase A): targets searches like
   "claude update google sheet", "AI agent append rows spreadsheet",
   "let claude edit my spreadsheet". */

export default function GoogleSheetsAgentPage() {
  return (
    <div className="pb-24">
      <div className="border-b border-border bg-card px-6 py-16 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mb-3.5 text-[34px] font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[42px]">
            An AI agent that can update your Google Sheets
          </h1>
          <p className="mx-auto max-w-[620px] text-[17px] leading-relaxed text-muted-foreground">
            Read values, update cells, append rows — on exactly the
            spreadsheets you expose and no others. Each sheet is granted
            read-only or read &amp; write, per agent profile; the rest of your
            Drive doesn&apos;t exist as far as the agent knows.
          </p>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-8 px-6 sm:px-8">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold text-foreground">How it works</h2>
          <ol className="m-0 flex list-decimal flex-col gap-2.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              Connect FGAC (
              <Link href="/setup" className="text-primary underline underline-offset-2">
                three-step setup
              </Link>
              ) — all spreadsheets start denied.
            </li>
            <li>
              Pick sheets with the Google Picker on an agent profile. Each
              starts read-only; flip individual sheets to read &amp; write when
              the agent should update them.
            </li>
            <li>
              Ask away: <em>&ldquo;What&apos;s in the Budget tab?&rdquo;</em>,{" "}
              <em>&ldquo;Append today&apos;s totals to the tracking sheet&rdquo;</em>,{" "}
              <em>&ldquo;Update the status column for closed items&rdquo;</em>.
            </li>
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold text-foreground">
            Things people build on it
          </h2>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>Logging daily metrics or expenses as appended rows</li>
            <li>Sweeping data out of Gmail (receipts, signups) into a tracking sheet</li>
            <li>A reporting agent that reads three sheets but can write to only one</li>
            <li>Keeping a CRM-ish sheet updated from conversation notes</li>
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            If an agent tries a sheet you haven&apos;t exposed — or a write on
            a read-only sheet — it&apos;s denied, and you get a one-click link
            to grant exactly that access if you want it.
          </p>
        </section>

        <div className="text-center">
          <Link
            href="/setup"
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Expose your first sheet
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-3 text-xs text-subtle">
            Free for personal use ·{" "}
            <Link href="/docs" className="underline hover:text-foreground">
              full documentation
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
