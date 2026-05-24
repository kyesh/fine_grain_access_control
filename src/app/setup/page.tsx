import React from "react";
import Link from "next/link";
import {
  Terminal,
  Shield,
  CheckCircle,
  ChevronRight,
  Zap,
  ArrowRight,
  Copy,
  Key,
  Box,
} from "lucide-react";

export const metadata = {
  title: "Setup & Integration | fgac.ai",
  description:
    "Connect your AI agents to fgac.ai in one command. Setup guides for Claude Code, Cursor, Windsurf, and Claude Desktop.",
};

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-gray-600 selection:bg-indigo-500/30 font-sans pb-24">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="relative border-b border-gray-200 bg-white/80 backdrop-blur-xl overflow-hidden py-16 sm:py-24">
        <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
          <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"></div>
        </div>
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-sm font-medium px-4 py-1.5 rounded-full border border-indigo-100 mb-6">
            <Zap className="w-4 h-4" />
            Works with any MCP client
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
            Secure Gmail access for your AI agents
          </h1>
          <p className="text-base sm:text-lg text-gray-600 max-w-xl mx-auto leading-relaxed">
            Add FGAC as an MCP server, sign in with Google, and control exactly
            what your agents can read, send, and delete.
          </p>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 lg:px-8 mt-12 sm:mt-16 space-y-16 sm:space-y-20">
        {/* ────────────────────────────────────────────────────────────── */}
        {/* STEP 1                                                        */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-8">
          <div className="flex items-start gap-4">
            <span className="bg-indigo-600 text-white w-9 h-9 rounded-full flex items-center justify-center text-base font-bold shadow-md shrink-0 mt-0.5">
              1
            </span>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Add the MCP server
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Every tool uses the same URL:{" "}
                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 text-xs font-mono">
                  https://fgac.ai/api/mcp
                </code>
              </p>
            </div>
          </div>

          {/* Claude Code — hero command */}
          <div className="bg-white border border-orange-200 rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center border border-orange-100">
                <Terminal className="w-4 h-4 text-orange-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Claude Code</h3>
            </div>
            <div className="bg-gray-950 text-gray-100 rounded-xl p-4 font-mono text-sm border border-gray-800 overflow-x-auto">
              <div className="flex items-center justify-between gap-4 min-w-0">
                <code className="text-emerald-400 whitespace-pre">
                  {`claude mcp add \\
  --transport http \\
  fgac https://fgac.ai/api/mcp`}
                </code>
                <button
                  className="shrink-0 p-1.5 rounded-lg bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition-colors"
                  title="Copy to clipboard"
                  aria-label="Copy Claude Code command"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Run this in any project directory. The server persists across sessions.
            </p>
          </div>

          {/* Other tools — text instructions, no fake command blocks */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h4 className="font-semibold text-gray-900 text-sm mb-2">
                Cursor
              </h4>
              <p className="text-xs text-gray-600 leading-relaxed">
                Open <strong>Settings → MCP Servers</strong>. Click{" "}
                <strong>Add new HTTP server</strong>. Paste the URL above.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h4 className="font-semibold text-gray-900 text-sm mb-2">
                Windsurf
              </h4>
              <p className="text-xs text-gray-600 leading-relaxed">
                Open <strong>Settings → MCP</strong>. Click{" "}
                <strong>Add Server</strong>. Choose Streamable HTTP and paste
                the URL above.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h4 className="font-semibold text-gray-900 text-sm mb-2">
                Claude Desktop
              </h4>
              <p className="text-xs text-gray-600 leading-relaxed">
                Open <strong>Settings → Developer → MCP Servers</strong>. Add a
                new server with type <strong>&quot;url&quot;</strong> and paste the URL above.
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center">
            FGAC uses <strong>MCP Streamable HTTP</strong> with OAuth 2.1 (DCR + PKCE).
            Your client handles authentication automatically.
          </p>
        </section>

        {/* ── Connector ─────────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="w-px h-10 bg-gradient-to-b from-gray-200 to-gray-300 relative">
            <ArrowRight className="w-4 h-4 text-gray-400 absolute -bottom-1.5 left-1/2 -translate-x-1/2 rotate-90" />
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* STEP 2                                                        */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-start gap-4">
            <span className="bg-emerald-600 text-white w-9 h-9 rounded-full flex items-center justify-center text-base font-bold shadow-md shrink-0 mt-0.5">
              2
            </span>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Sign in &amp; approve the connection
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Your agent triggers an OAuth flow. Then approve it in your dashboard.
              </p>
            </div>
          </div>

          {/* Flow diagram */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
            <ol className="space-y-4 text-sm text-gray-700">
              <li className="flex items-start gap-3">
                <span className="bg-emerald-50 text-emerald-700 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-emerald-100">
                  A
                </span>
                <div>
                  <strong className="text-gray-900">
                    Your agent tries to use a tool
                  </strong>
                  <span className="text-gray-500">
                    {" "}— a browser window opens asking you to sign in with Google.
                    This links your agent to your FGAC account. No API keys needed.
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="bg-emerald-50 text-emerald-700 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-emerald-100">
                  B
                </span>
                <div>
                  <strong className="text-gray-900">
                    Approve in your{" "}
                    <Link
                      href="/dashboard"
                      className="text-indigo-600 hover:text-indigo-700 underline underline-offset-2 decoration-indigo-300"
                    >
                      FGAC Dashboard
                    </Link>
                  </strong>
                  <span className="text-gray-500">
                    {" "}— new connections appear as <strong className="text-amber-600">⏳&nbsp;Pending</strong>.
                    Click Approve and assign a Key Profile to grant access.
                  </span>
                </div>
              </li>
            </ol>
          </div>

          {/* Compact visual flow */}
          <div className="bg-gradient-to-r from-emerald-50 via-white to-indigo-50 border border-emerald-100 rounded-xl px-4 py-3">
            <div className="flex items-center justify-center gap-2 flex-wrap text-xs font-medium">
              <span className="bg-white border border-gray-200 px-3 py-1.5 rounded-lg text-gray-600 shadow-sm">
                Agent connects
              </span>
              <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="bg-white border border-gray-200 px-3 py-1.5 rounded-lg text-gray-600 shadow-sm">
                OAuth sign-in
              </span>
              <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg text-amber-700 shadow-sm">
                ⏳ Pending
              </span>
              <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg text-emerald-700 shadow-sm">
                ✓ Approved
              </span>
            </div>
          </div>
        </section>

        {/* ── Connector ─────────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="w-px h-10 bg-gradient-to-b from-gray-200 to-gray-300 relative">
            <ArrowRight className="w-4 h-4 text-gray-400 absolute -bottom-1.5 left-1/2 -translate-x-1/2 rotate-90" />
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* STEP 3                                                        */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-start gap-4">
            <span className="bg-brand-purple text-white w-9 h-9 rounded-full flex items-center justify-center text-base font-bold shadow-md shrink-0 mt-0.5">
              3
            </span>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Set access rules
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Control exactly what each agent can read, send, and delete.
              </p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-gray-900 text-sm">Read Blocklist</strong>
                <p className="text-xs text-gray-500 mt-0.5">
                  Block sensitive emails — 2FA codes, password resets, financial alerts.
                  Uses regex pattern matching on subjects and senders.
                </p>
              </div>
            </div>
            <hr className="border-gray-100" />
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-gray-900 text-sm">Send Whitelist</strong>
                <p className="text-xs text-gray-500 mt-0.5">
                  Only allow sending to approved domains or specific email addresses.
                  Everything else is rejected.
                </p>
              </div>
            </div>
            <hr className="border-gray-100" />
            <div className="flex items-start gap-3">
              <Key className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-gray-900 text-sm">Per-Agent Profiles</strong>
                <p className="text-xs text-gray-500 mt-0.5">
                  Create separate profiles with different permissions.
                  Assign each agent connection to the right one.
                </p>
              </div>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-brand-purple text-white px-5 py-2.5 rounded-full text-sm font-medium hover:opacity-90 transition-all shadow-md"
            >
              Open Dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* Multiple accounts — collapsible info                          */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 border border-indigo-100 rounded-2xl p-6 sm:p-8 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-100 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-indigo-100 rounded-xl">
                <Box className="w-5 h-5 text-indigo-600" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">
                Multiple email accounts
              </h2>
            </div>
            <p className="text-sm text-gray-700 mb-4 leading-relaxed max-w-xl">
              One agent connection can access multiple Gmail inboxes.
              Other users delegate access from their own FGAC dashboard, then your agent
              uses the <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-indigo-700 text-xs font-mono">account</code> parameter
              to specify which inbox.
            </p>

            <div className="bg-white/80 border border-gray-200 rounded-xl p-4 backdrop-blur-sm space-y-2.5">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 font-mono text-sm">
                <span className="text-gray-400 text-xs block mb-0.5">Your inbox</span>
                <span className="text-emerald-600 font-semibold">gmail_list</span>
                <span className="text-gray-400"> → returns your emails</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 font-mono text-sm">
                <span className="text-gray-400 text-xs block mb-0.5">Delegated inbox</span>
                <span className="text-emerald-600 font-semibold">gmail_list</span>{" "}
                <span className="text-gray-400">account=</span>
                <span className="text-indigo-600 font-semibold">boss@company.com</span>
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* Advanced: Proxy Key                                           */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="border-t border-gray-200 pt-12 space-y-5">
          <div className="text-center">
            <h2 className="text-base font-bold text-gray-900 mb-1">
              Alternative: Direct Proxy Key
            </h2>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              For agents that don&apos;t support MCP, create a proxy API key and
              use our downloadable skill files.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-1.5 text-sm text-gray-700 bg-white border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Create Key in Dashboard
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <a
              href="/skills/claude-code/SKILL.md"
              target="_blank"
              className="inline-flex items-center justify-center gap-1.5 text-sm text-gray-700 bg-white border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Claude Code SKILL.md
              <Terminal className="w-3.5 h-3.5" />
            </a>
            <a
              href="/skills/open-claw/SKILL.md"
              target="_blank"
              className="inline-flex items-center justify-center gap-1.5 text-sm text-gray-700 bg-white border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Open Claw SKILL.md
              <Terminal className="w-3.5 h-3.5" />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
