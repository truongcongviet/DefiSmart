"use client";

import { ArrowDown, ArrowUpRight, Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";

import { useAuthFlow } from "@/components/auth/auth-flow-provider";
import { NetworkMark } from "@/components/auth/network-mark";
import { TokenList } from "@/components/token-mark";
import { shortAddress } from "@/lib/auth/account";
import { NETWORKS, NETWORK_LIST } from "@/lib/chains";
import { button, panel } from "@/lib/ui";
import { cn } from "@/lib/utils";

const SPEC_ROWS = [
  {
    name: "Sign-in",
    value: "Wallet extension · WalletConnect QR · email code",
    note: "Gas-free signature",
  },
  {
    name: "Network",
    value: "Solana or Robinhood Chain",
    note: "Bound once per account",
  },
  {
    name: "Agent wallet",
    value: "Created on first sign-in",
    note: "Key exportable any time",
  },
  {
    name: "Positions",
    value: "Opened from the agent wallet",
    note: "No popup per transaction",
  },
  {
    name: "Session",
    value: "7 days",
    note: "httpOnly cookie",
  },
];

const STEPS = [
  {
    stage: "1.0",
    title: "Connect.",
    body: "Phantom, Solflare or Backpack on Solana. MetaMask or Rabby on Robinhood Chain. WalletConnect QR for mobile, or an email address and a six-digit code.",
  },
  {
    stage: "2.0",
    title: "Bind a network.",
    body: "A wallet decides the network for you. Email accounts pick Solana or Robinhood Chain once; the choice is permanent for that account.",
  },
  {
    stage: "3.0",
    title: "Fund the agent wallet.",
    body: "Send SOL, or ETH and USDG, to the agent address. Keep a reserve for fees and position rent; about 5 SOL or 0.08 ETH is a sensible start.",
  },
  {
    stage: "4.0",
    title: "Trade from it.",
    body: "Positions open, rebalance and close from the agent wallet. Withdrawals and key exports still require your own signature.",
  },
];

export function LoginLanding() {
  const { configured, ready, authenticated, account, openConnect, needsSetup } =
    useAuthFlow();

  const signedIn = Boolean(ready && authenticated && account);

  return (
    <main className="mx-auto w-full max-w-[var(--page-max)] px-[var(--page-gutter)]">
      {/* ── Hero · split: copy left, live product frame right ── */}
      <section className="grid min-h-[calc(100svh-var(--nav-height))] items-center gap-12 py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20 lg:py-24">
        <div className="flex flex-col">
          <p
            className="eyebrow reveal"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            01 — Sign in
          </p>
          <h1
            className="display reveal text-ink mt-5"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            One account. One network. One agent wallet.
          </h1>
          <p
            className="lede reveal mt-6"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            Connect a Solana or Robinhood Chain wallet, or use an email code. A
            separate agent wallet is created the moment you sign in, and your
            positions open from it without a wallet popup each time.
          </p>

          <div
            className="reveal mt-9 flex flex-wrap items-center gap-x-6 gap-y-3"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            {!signedIn && (
              <button
                type="button"
                onClick={openConnect}
                disabled={!configured || !ready}
                className={cn(button.base, button.primary)}
              >
                {configured ? "Connect wallet" : "Set NEXT_PUBLIC_PRIVY_APP_ID"}
              </button>
            )}
            {signedIn && needsSetup && (
              <button
                type="button"
                onClick={openConnect}
                className={cn(button.base, button.primary)}
              >
                Finish creating the agent wallet
              </button>
            )}
            {signedIn && !needsSetup && (
              <a href="/pool" className={cn(button.base, button.primary)}>
                Browse pools
                <ArrowUpRight className="h-4 w-4" />
              </a>
            )}
            <a
              href="#how-it-works"
              className="text-ink-2 decoration-rule-2 hover:text-ink hover:decoration-accent inline-flex items-center gap-1.5 text-sm underline underline-offset-4 transition-colors"
            >
              How the agent wallet works
              <ArrowDown className="h-3.5 w-3.5" />
            </a>
          </div>

          <p
            className="reveal text-muted mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs"
            style={{ "--i": 4 } as React.CSSProperties}
          >
            {NETWORK_LIST.map((network, index) => (
              <span key={network.id} className="inline-flex items-center gap-2">
                {index > 0 && (
                  <span aria-hidden className="text-rule-2 mr-1">
                    /
                  </span>
                )}
                <NetworkMark network={network.id} className="h-5 w-5" />
                {network.label} · {network.protocols}
                <TokenList
                  tokens={network.fundingTokenList}
                  markClassName="h-4 w-4"
                  className="text-ink-2 ml-1"
                />
              </span>
            ))}
          </p>
        </div>

        <div className="reveal" style={{ "--i": 2 } as React.CSSProperties}>
          <ProductFrame />
        </div>
      </section>

      {/* ── 02 · Step sequence ── */}
      <section
        id="how-it-works"
        className="border-rule scroll-mt-[calc(var(--nav-height)+1rem)] border-t py-20 lg:py-28"
      >
        <div className="flex max-w-[var(--measure)] flex-col">
          <p className="eyebrow">02 — What happens next</p>
          <h2 className="display-s text-ink mt-4">
            From sign-in to the first position.
          </h2>
        </div>

        <ol className="divide-rule mt-14 divide-y">
          {STEPS.map((step) => (
            <li
              key={step.stage}
              className="grid gap-3 py-8 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-8"
            >
              <span className="tnum text-accent font-mono text-sm">
                {step.stage}
              </span>
              <div>
                <h3 className="text-ink text-xl font-medium tracking-tight">
                  {step.title}
                </h3>
                <p className="text-ink-2 mt-2 max-w-[var(--measure)] text-base leading-7">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Ft2 · inline rule single line ── */}
      <footer className="border-rule border-t py-8">
        <p className="text-muted font-mono text-xs leading-6">
          © 2026 CopyPilot · Login flow modelled on LP Agent · Not affiliated
          with Meteora, Uniswap or Robinhood · Nothing here is financial advice
        </p>
      </footer>
    </main>
  );
}

/**
 * Workbench frame: the actual account panel. Before sign-in it reads as a spec
 * sheet of the flow; after sign-in it shows the real agent wallet.
 */
function ProductFrame() {
  const { ready, authenticated, account, serverSession } = useAuthFlow();
  const [copied, setCopied] = useState(false);

  const signedIn = Boolean(ready && authenticated && account);
  const network = account?.network ? NETWORKS[account.network] : null;
  const agent = account?.agentWallet ?? null;

  async function copy() {
    if (!agent) {
      return;
    }

    await navigator.clipboard.writeText(agent.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div
      className={cn(
        panel,
        "overflow-hidden shadow-[0_24px_60px_-28px_oklch(0%_0_0/0.6)]",
      )}
    >
      <div className="border-rule bg-paper-3/60 flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="text-muted font-mono text-xs">
          account
          <span className="text-rule-2"> / </span>
          {signedIn ? "agent-wallet" : "sign-in"}
        </span>
        <span className="text-muted inline-flex items-center gap-2 font-mono text-[11px]">
          <span
            aria-hidden
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              signedIn && agent ? "bg-ok" : signedIn ? "bg-warn" : "bg-rule-2",
            )}
          />
          {signedIn && agent ? "ready" : signedIn ? "setup pending" : "idle"}
        </span>
      </div>

      {signedIn && account ? (
        <dl className="divide-rule divide-y">
          <FrameRow label="Signed in as" value={account.identityLabel} />
          <FrameRow
            label="Network"
            value={
              network ? (
                <span className="inline-flex items-center gap-2">
                  <NetworkMark
                    network={network.id}
                    className="h-6 w-6 text-[9px]"
                  />
                  {network.label}
                </span>
              ) : (
                "Not chosen yet"
              )
            }
            note={network?.protocols}
          />
          <FrameRow
            label="Agent wallet"
            value={
              agent ? (
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-sm" title={agent.address}>
                    {shortAddress(agent.address, 6)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    aria-label="Copy agent wallet address"
                    className="text-muted hover:bg-paper-3 hover:text-ink inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  >
                    {copied ? (
                      <Check className="text-ok h-3.5 w-3.5" />
                    ) : (
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </span>
              ) : (
                "Not created yet"
              )
            }
            note={
              network ? (
                <span className="inline-flex items-center gap-1.5">
                  Fund with
                  <TokenList
                    tokens={network.fundingTokenList}
                    markClassName="h-4 w-4"
                  />
                </span>
              ) : undefined
            }
          />
          <FrameRow
            label="Session"
            value={
              serverSession.configured && serverSession.expiresAt
                ? `Until ${new Date(serverSession.expiresAt * 1000).toLocaleDateString()}`
                : "7 days"
            }
            note={
              serverSession.configured ? "httpOnly cookie" : "Privy session"
            }
          />
        </dl>
      ) : (
        <dl className="divide-rule divide-y">
          {SPEC_ROWS.map((row) => (
            <FrameRow
              key={row.name}
              label={row.name}
              value={row.value}
              note={row.note}
            />
          ))}
        </dl>
      )}
    </div>
  );
}

function FrameRow({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted font-mono text-xs leading-6">{label}</dt>
      <dd className="min-w-0">
        <div className="text-ink text-sm leading-6">{value}</div>
        {note && <div className="text-muted text-xs leading-5">{note}</div>}
      </dd>
    </div>
  );
}
