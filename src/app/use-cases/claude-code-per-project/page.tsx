import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CopyButton } from "../../setup/CopyButton";

export const metadata = {
  title: "Per-Project Agent Profiles in Claude Code | fgac.ai",
  description:
    "Scope FGAC to a single Claude Code project directory, and map each project to its own agent profile just by the MCP URL it connects to — different permissions per project, zero dashboard steps.",
};

/* SEO landing page: targets searches like "claude code project mcp server",
   "scope mcp server to directory", "claude code per-project permissions".

   The mechanism: /api/mcp/<profile-slug> URLs bind a NEW MCP connection to
   the profile whose label slugifies to <slug> (see src/lib/profileSlugs.ts).
   Claude Code keeps MCP OAuth per project + server entry, so every project
   can use the same server name with a different profile URL. */

const CMD_ADD = `claude mcp add \\
  --transport http \\
  fgac https://fgac.ai/api/mcp/research-bot`;

const MCP_JSON = `{
  "mcpServers": {
    "fgac": {
      "type": "http",
      "url": "https://fgac.ai/api/mcp/research-bot"
    }
  }
}`;

function CommandBlock({ cmd, label }: { cmd: string; label: string }) {
  return (
    <div className="overflow-x-auto rounded-sm bg-surface-inverse p-4 font-mono text-sm text-surface-inverse-foreground">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <code className="whitespace-pre text-primary">{cmd}</code>
        <CopyButton
          value={cmd}
          label={label}
          className="rounded-sm bg-foreground/10 p-1.5 text-muted-foreground hover:text-surface-inverse-foreground"
        />
      </div>
    </div>
  );
}

export default function ClaudeCodePerProjectPage() {
  return (
    <div className="pb-24">
      <div className="border-b border-border bg-card px-6 py-16 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mb-3.5 text-[34px] font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[42px]">
            One profile per project in Claude Code
          </h1>
          <p className="mx-auto max-w-[620px] text-[17px] leading-relaxed text-muted-foreground">
            Add FGAC to a single project directory instead of all of Claude —
            and pick which agent profile that project gets just by the URL it
            connects to. Your research repo reads mail; your ops repo can
            send it. Neither knows the other exists.
          </p>
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-8 px-6 sm:px-8">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold text-foreground">
            The URL is the profile
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every agent profile in your{" "}
            <Link href="/dashboard" className="text-primary underline underline-offset-2">
              FGAC dashboard
            </Link>{" "}
            has its own MCP endpoint:{" "}
            <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
              https://fgac.ai/api/mcp/&lt;profile&gt;
            </code>
            . An agent that completes OAuth against a profile&apos;s URL
            attaches to that profile automatically — its rules, its mailboxes,
            its spreadsheet grants. The plain{" "}
            <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
              /api/mcp
            </code>{" "}
            endpoint keeps working and maps to your read-only Default Profile.
            Copy each profile&apos;s URL (or its ready-made command) from the{" "}
            <strong>Connect a new agent via MCP</strong> card on the profile.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-xl font-bold text-foreground">
            Set it up in a project directory
          </h2>
          <ol className="m-0 flex list-decimal flex-col gap-5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground">Add the server in your project.</strong>{" "}
              Run this inside the project directory (swap{" "}
              <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                research-bot
              </code>{" "}
              for your profile&apos;s URL from the dashboard):
              <div className="mt-2.5">
                <CommandBlock cmd={CMD_ADD} label="Copy claude mcp add command" />
              </div>
              <p className="mt-2.5">
                This scopes the server to that directory only — other projects
                and the rest of Claude never see it. Prefer config files? The
                same thing as a{" "}
                <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                  .mcp.json
                </code>{" "}
                in the project root (checked in, so your whole team gets the
                entry — each person still signs in as themselves):
              </p>
              <div className="mt-2.5">
                <CommandBlock cmd={MCP_JSON} label="Copy .mcp.json" />
              </div>
            </li>
            <li>
              <strong className="text-foreground">Sign in.</strong> Run{" "}
              <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                claude mcp login fgac
              </code>{" "}
              in the same directory and approve the browser prompt — done. Or
              authenticate from inside Claude Code: start a session, send any
              first message, then run{" "}
              <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                /mcp
              </code>{" "}
              and pick <strong>fgac → Authenticate</strong>. (A freshly added
              server appears only in <em>new</em> sessions, and{" "}
              <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                /mcp
              </code>{" "}
              lists it after the session has started — so: new session, one
              message, then /mcp.)
            </li>
            <li>
              <strong className="text-foreground">That&apos;s it.</strong>{" "}
              The connection appears in your dashboard already attached to the
              profile from the URL. Re-scope, upgrade, or block it there any
              time — the agent never holds Google credentials, so changes take
              effect immediately.
            </li>
          </ol>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold text-foreground">
            Same name everywhere, different powers per project
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Call the server{" "}
            <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
              fgac
            </code>{" "}
            in every project. Claude Code keeps a separate sign-in per project
            for the same server name, and each sign-in registers its own OAuth
            client with FGAC — so your inbox-triage repo on{" "}
            <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
              /api/mcp/inbox-agent
            </code>{" "}
            and your reporting repo on{" "}
            <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
              /api/mcp/sheets-agent
            </code>{" "}
            show up as two independent connections, each bound to its own
            profile, each revocable on its own. The URL decides the profile
            once, at first sign-in; changing a connection&apos;s profile later
            is a dashboard action, never a silent side effect of a URL.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-bold text-foreground">Good to know</h2>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              Profile URLs use the profile&apos;s label, lowercased and
              hyphenated: <em>&ldquo;Research Bot&rdquo;</em> →{" "}
              <code className="rounded-xs bg-primary-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                research-bot
              </code>
              . The dashboard shows the exact URL, so copying beats guessing.
            </li>
            <li>
              A URL whose profile doesn&apos;t exist (typo, deleted profile)
              still connects — it just falls back to the read-only Default
              Profile, so a mistake can never grant more than the default.
            </li>
            <li>
              This works in Claude Code everywhere it runs — terminal, the
              desktop app, and IDE extensions — and the same per-profile URLs
              work in Cursor, Windsurf, and any other MCP client.
            </li>
          </ul>
        </section>

        <div className="text-center">
          <Link
            href="/setup"
            className="inline-flex items-center gap-2 rounded-sm bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Full setup guide
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
