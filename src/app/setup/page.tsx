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
  Server,
  Box,
} from "lucide-react";

export const metadata = {
  title: "Setup & Integration | fgac.ai",
  description:
    "Connect your AI agents to fgac.ai in one command. Setup guides for Claude Code, Cursor, Windsurf, and Claude Desktop.",
};

/* ─── Copy button (client component inlined) ─────────────────────────────── */

function CopyBlock({ command, label }: { command: string; label?: string }) {
  return (
    <div className="group relative">
      {label && (
        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1.5 block">
          {label}
        </span>
      )}
      <div className="bg-gray-950 text-gray-100 rounded-xl p-4 font-mono text-sm flex items-center justify-between gap-4 border border-gray-800 shadow-inner overflow-x-auto">
        <code className="whitespace-nowrap">{command}</code>
        <button
          className="shrink-0 p-1.5 rounded-lg bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition-colors"
          title="Copy to clipboard"
          aria-label="Copy command"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ─── Agent card ─────────────────────────────────────────────────────────── */

interface AgentSetupProps {
  name: string;
  icon: string;
  command: string;
  note?: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

function AgentCard({
  name,
  icon,
  command,
  note,
  color,
  bgColor,
  borderColor,
}: AgentSetupProps) {
  return (
    <div
      className={`bg-white border ${borderColor} p-6 rounded-2xl hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5`}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`w-10 h-10 ${bgColor} rounded-xl flex items-center justify-center text-xl`}
        >
          {icon}
        </div>
        <h3 className={`text-lg font-bold text-gray-900`}>{name}</h3>
      </div>
      <div className="bg-gray-950 text-gray-100 rounded-xl p-3.5 font-mono text-xs flex items-center justify-between gap-3 border border-gray-800 shadow-inner overflow-x-auto">
        <code className="whitespace-nowrap">{command}</code>
        <button
          className="shrink-0 p-1 rounded-lg bg-white/10 text-gray-400 hover:text-white hover:bg-white/20 transition-colors"
          title="Copy to clipboard"
          aria-label={`Copy ${name} command`}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      {note && <p className="text-xs text-gray-500 mt-2.5 leading-relaxed">{note}</p>}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-gray-600 selection:bg-indigo-500/30 font-sans pb-24">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div className="relative border-b border-gray-200 bg-white/80 backdrop-blur-xl overflow-hidden py-20 sm:py-28">
        <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
          <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"></div>
        </div>
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-sm font-medium px-4 py-1.5 rounded-full border border-indigo-100 mb-6">
            <Zap className="w-4 h-4" />
            One Command Setup
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-gray-900 mb-6">
            Connect Your Agents
          </h1>
          <p className="text-lg text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            Add FGAC as an MCP server in your favorite AI tool.
            Your agent authenticates via OAuth — no API keys to copy or rotate.
          </p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 lg:px-8 mt-16 space-y-20">
        {/* ────────────────────────────────────────────────────────────── */}
        {/* STEP 1: Connect Your Agent                                    */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="bg-indigo-600 text-white w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow-md">
              1
            </span>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Add the MCP Server
              </h2>
              <p className="text-gray-500 text-sm">
                Run the command for your tool — that&apos;s it.
              </p>
            </div>
          </div>

          {/* Agent grid */}
          <div className="grid sm:grid-cols-2 gap-5">
            <AgentCard
              name="Claude Code"
              icon="⌨️"
              command="claude mcp add --transport http fgac https://fgac.ai/api/mcp"
              note="Works in any project directory. The server persists across sessions."
              color="text-orange-600"
              bgColor="bg-orange-50"
              borderColor="border-orange-200/60"
            />
            <AgentCard
              name="Cursor"
              icon="🖱️"
              command='Add to .cursor/mcp.json: {"fgac": {"url": "https://fgac.ai/api/mcp"}}'
              note="Settings → MCP Servers → Add new HTTP server with the URL above."
              color="text-blue-600"
              bgColor="bg-blue-50"
              borderColor="border-blue-200/60"
            />
            <AgentCard
              name="Windsurf"
              icon="🏄"
              command='Add to mcp_config.json: {"fgac": {"serverUrl": "https://fgac.ai/api/mcp"}}'
              note="Settings → MCP → Add server. Use Streamable HTTP transport."
              color="text-teal-600"
              bgColor="bg-teal-50"
              borderColor="border-teal-200/60"
            />
            <AgentCard
              name="Claude Desktop"
              icon="🖥️"
              command='Add to claude_desktop_config.json under "mcpServers"'
              note='Add {"fgac": {"type": "url", "url": "https://fgac.ai/api/mcp"}} to your config.'
              color="text-purple-600"
              bgColor="bg-purple-50"
              borderColor="border-purple-200/60"
            />
          </div>

          {/* Generic MCP URL callout */}
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
            <p className="text-sm text-gray-700 mb-3">
              <strong>Any MCP-compatible client</strong> — use this URL:
            </p>
            <CopyBlock command="https://fgac.ai/api/mcp" />
            <p className="text-xs text-gray-500 mt-3">
              FGAC supports the <strong>MCP Streamable HTTP</strong> transport with OAuth 2.1 (DCR + PKCE).
              Your client will be guided through authentication automatically.
            </p>
          </div>
        </section>

        {/* ── Connector arrow ────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="w-px h-12 bg-gradient-to-b from-gray-200 to-gray-300 relative">
            <ArrowRight className="w-5 h-5 text-gray-400 absolute -bottom-2 left-1/2 -translate-x-1/2 rotate-90" />
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* STEP 2: Authorize in the browser                              */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="bg-emerald-600 text-white w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow-md">
              2
            </span>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Authorize &amp; Approve
              </h2>
              <p className="text-gray-500 text-sm">
                Sign in, then approve the connection in your dashboard.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* OAuth step */}
            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center border border-emerald-100">
                  <span className="text-emerald-700 font-bold text-sm">A</span>
                </div>
                <h3 className="font-semibold text-gray-900">OAuth Sign-In</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                When you first use an FGAC tool, a browser window opens asking you to sign in with Google.
                This links your agent to your FGAC account — <strong>no API keys needed</strong>.
              </p>
            </div>

            {/* Dashboard approval step */}
            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center border border-emerald-100">
                  <span className="text-emerald-700 font-bold text-sm">B</span>
                </div>
                <h3 className="font-semibold text-gray-900">
                  Approve in Dashboard
                </h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                New connections appear as <strong>&quot;⏳ Pending Approval&quot;</strong> in your{" "}
                <Link
                  href="/dashboard"
                  className="text-indigo-600 hover:text-indigo-700 font-medium underline underline-offset-2 decoration-indigo-300"
                >
                  FGAC Dashboard
                </Link>
                . Click <strong>✓ Approve</strong> and assign a <strong>Key Profile</strong>{" "}
                to grant access.
              </p>
            </div>
          </div>

          {/* Visual flow */}
          <div className="bg-gradient-to-r from-emerald-50 via-white to-indigo-50 border border-emerald-100 rounded-2xl p-6 sm:p-8">
            <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap text-sm font-medium">
              <span className="bg-white border border-gray-200 px-4 py-2 rounded-xl text-gray-700 shadow-sm">
                Agent connects
              </span>
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="bg-white border border-gray-200 px-4 py-2 rounded-xl text-gray-700 shadow-sm">
                OAuth sign-in
              </span>
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl text-amber-700 shadow-sm">
                ⏳ Pending
              </span>
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl text-emerald-700 shadow-sm">
                ✓ Approved
              </span>
            </div>
          </div>
        </section>

        {/* ── Connector arrow ────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="w-px h-12 bg-gradient-to-b from-gray-200 to-gray-300 relative">
            <ArrowRight className="w-5 h-5 text-gray-400 absolute -bottom-2 left-1/2 -translate-x-1/2 rotate-90" />
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* STEP 3: Configure Access Rules                                */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="bg-brand-purple text-white w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow-md">
              3
            </span>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Configure Access Rules
              </h2>
              <p className="text-gray-500 text-sm">
                Control exactly what your agent can read, send, and access.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center mb-4 border border-red-100">
                <Shield className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">
                Read Blocklist
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Block agents from reading sensitive emails — 2FA codes, password resets, financial alerts.
                Uses regex pattern matching.
              </p>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center mb-4 border border-emerald-100">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">
                Send Whitelist
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Only allow sending to approved recipients.
                Whitelist specific domains or email addresses.
              </p>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center mb-4 border border-indigo-100">
                <Key className="w-5 h-5 text-indigo-500" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">
                Per-Agent Profiles
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                Create separate key profiles with different permissions.
                Assign each agent connection to the right profile.
              </p>
            </div>
          </div>

          <div className="text-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-brand-purple text-white px-6 py-3 rounded-full font-medium hover:opacity-90 transition-all shadow-md hover:shadow-lg"
            >
              Open Dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* Multiple Accounts Info                                        */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 border border-indigo-100 rounded-3xl p-8 sm:p-12 relative overflow-hidden shadow-sm">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-100 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-indigo-100 rounded-xl">
                <Box className="w-6 h-6 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                Multiple Email Accounts
              </h2>
            </div>
            <p className="text-gray-700 mb-6 leading-relaxed text-lg max-w-2xl">
              A single agent connection can access multiple Gmail inboxes.
              Use the <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-indigo-700 text-sm font-mono">account</code>{" "}
              parameter on any tool to specify which inbox to use.
            </p>

            <div className="bg-white/80 border border-gray-200 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
              <h4 className="text-gray-900 font-medium mb-3">
                Delegated account access:
              </h4>
              <p className="text-gray-600 mb-4 text-sm">
                Other users can delegate their inbox to you from their FGAC dashboard.
                Once delegated, your agent can access their emails through the same connection.
              </p>
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 font-mono text-sm shadow-inner">
                  <span className="text-gray-500 block mb-1 text-xs uppercase tracking-wider font-semibold">
                    Your inbox (default)
                  </span>
                  <span className="text-emerald-600 font-semibold">
                    gmail_list
                  </span>{" "}
                  <span className="text-gray-500">→ returns your emails</span>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 font-mono text-sm shadow-inner">
                  <span className="text-gray-500 block mb-1 text-xs uppercase tracking-wider font-semibold">
                    Delegated inbox
                  </span>
                  <span className="text-emerald-600 font-semibold">
                    gmail_list
                  </span>{" "}
                  <span className="text-gray-500">account=</span>
                  <span className="text-indigo-600 font-semibold">
                    boss@company.com
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────── */}
        {/* Advanced: Proxy Key Skills (collapsed)                        */}
        {/* ────────────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2">
              Advanced: Direct Proxy Key Setup
            </h2>
            <p className="text-gray-500 text-sm max-w-xl mx-auto">
              For agents that don&apos;t support MCP, you can create a proxy API key
              and use our downloadable skills to configure the connection manually.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center border border-gray-200">
                  <Server className="w-4 h-4 text-gray-500" />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">
                  Step 1: Create Account &amp; Key
                </h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Sign up, then create a Proxy Key in the dashboard.
                Select which email inboxes this key can access.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center text-indigo-600 hover:text-indigo-700 font-medium text-sm transition-colors"
              >
                Open Dashboard <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center border border-gray-200">
                  <Terminal className="w-4 h-4 text-gray-500" />
                </div>
                <h3 className="font-semibold text-gray-900 text-sm">
                  Step 2: Install Skill
                </h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Download the skill file for your agent and place it in the workspace.
              </p>
              <div className="space-y-2">
                <a
                  href="/skills/claude-code/SKILL.md"
                  target="_blank"
                  className="block text-center py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors border border-gray-200"
                >
                  Claude Code SKILL.md
                </a>
                <a
                  href="/skills/open-claw/SKILL.md"
                  target="_blank"
                  className="block text-center py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium transition-colors border border-gray-200"
                >
                  Open Claw SKILL.md
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
