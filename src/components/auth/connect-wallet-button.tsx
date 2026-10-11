"use client";

import {
  useExportWallet as useExportEthereumWallet,
  useLinkAccount,
} from "@privy-io/react-auth";
import { useExportWallet as useExportSolanaWallet } from "@privy-io/react-auth/solana";
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  KeyRound,
  Link2,
  LoaderCircle,
  LogOut,
  Mail,
} from "lucide-react";
import { useState } from "react";

import { useAuthFlow } from "@/components/auth/auth-flow-provider";
import { NetworkMark } from "@/components/auth/network-mark";
import { shortAddress } from "@/lib/auth/account";
import { NETWORKS } from "@/lib/chains";
import { button } from "@/lib/ui";
import { cn } from "@/lib/utils";

const navButton = cn(button.base, button.small);

export function ConnectWalletButton() {
  const flow = useAuthFlow();

  if (!flow.configured) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable sign-in"
        className={cn(navButton, button.outline, "text-warn")}
      >
        Set up Privy
      </button>
    );
  }

  if (!flow.ready) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={cn(navButton, button.outline)}
      >
        <LoaderCircle className="h-4 w-4 animate-spin" />
        <span className="sr-only">Loading session</span>
      </button>
    );
  }

  if (!flow.authenticated || !flow.account) {
    return (
      <button
        type="button"
        onClick={flow.openConnect}
        className={cn(navButton, button.primary)}
      >
        Connect wallet
      </button>
    );
  }

  if (flow.needsSetup) {
    return (
      <button
        type="button"
        onClick={flow.openConnect}
        className={cn(navButton, button.outline, "text-warn")}
      >
        Finish setup
      </button>
    );
  }

  return <AccountMenu />;
}

function AccountMenu() {
  const { account, serverSession, logout } = useAuthFlow();
  const { exportWallet: exportEthereumWallet } = useExportEthereumWallet();
  const { exportWallet: exportSolanaWallet } = useExportSolanaWallet();
  const { linkEmail, linkWallet } = useLinkAccount();
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<"logout" | "export" | null>(null);

  if (!account?.agentWallet || !account.network) {
    return null;
  }

  const network = NETWORKS[account.network];
  const agentWallet = account.agentWallet;
  const ownerWallet = account.ownerWallets[0] ?? null;

  async function copy(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  async function handleExport() {
    setBusy("export");

    try {
      if (agentWallet.chainType === "solana") {
        await exportSolanaWallet({ address: agentWallet.address });
      } else {
        await exportEthereumWallet({ address: agentWallet.address });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    setBusy("logout");

    try {
      await logout();
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="group relative shrink-0">
      <summary
        className={cn(
          navButton,
          button.subtle,
          "cursor-pointer list-none pr-3 pl-1.5 font-mono",
        )}
      >
        <NetworkMark
          network={account.network}
          className="h-6 w-8 rounded-full text-[9px]"
        />
        <span className="hidden sm:inline">
          {shortAddress(agentWallet.address)}
        </span>
        <ChevronDown className="text-muted h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
      </summary>

      <div className="modal-panel rounded-card border-rule bg-paper-2 absolute top-[calc(100%+0.625rem)] right-0 z-50 w-[min(22rem,calc(100vw-2rem))] border p-2 shadow-[0_24px_60px_-28px_oklch(0%_0_0/0.7)]">
        <div className="px-3 pt-3 pb-2">
          <p className="text-ink truncate text-sm font-medium">
            {account.identityLabel}
          </p>
          <p className="text-muted mt-0.5 font-mono text-[11px]">
            {network.label} · {network.protocols}
          </p>
        </div>

        <div className="divide-rule bg-paper-3/60 mt-1 divide-y rounded-[10px]">
          <AddressRow
            label="Agent wallet"
            address={agentWallet.address}
            explorerUrl={network.explorerAddressUrl(agentWallet.address)}
            copied={copied === "agent"}
            onCopy={() => void copy("agent", agentWallet.address)}
          />
          {ownerWallet && (
            <AddressRow
              label="Login wallet"
              address={ownerWallet.address}
              copied={copied === "owner"}
              onCopy={() => void copy("owner", ownerWallet.address)}
            />
          )}
        </div>

        <p className="text-muted px-3 pt-3 pb-2 text-xs leading-5">
          Deposit {network.fundingTokens} to the agent wallet to open positions.
          {serverSession.configured && serverSession.expiresAt
            ? ` Session valid until ${new Date(serverSession.expiresAt * 1000).toLocaleString()}.`
            : " Sessions stay signed in for 7 days."}
        </p>

        <div className="border-rule mt-1 flex flex-col border-t pt-1">
          <MenuAction
            icon={
              busy === "export" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )
            }
            label="Export private key"
            onClick={() => void handleExport()}
            disabled={busy !== null}
          />
          {!account.email && (
            <MenuAction
              icon={<Mail className="h-4 w-4" />}
              label="Link an email"
              onClick={() => linkEmail()}
              disabled={busy !== null}
            />
          )}
          {!ownerWallet && (
            <MenuAction
              icon={<Link2 className="h-4 w-4" />}
              label={`Link a ${network.label} wallet`}
              onClick={() =>
                linkWallet({
                  walletChainType:
                    account.network === "solana"
                      ? "solana-only"
                      : "ethereum-only",
                })
              }
              disabled={busy !== null}
            />
          )}
          <MenuAction
            icon={
              busy === "logout" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )
            }
            label="Sign out"
            onClick={() => void handleLogout()}
            disabled={busy !== null}
          />
        </div>
      </div>
    </details>
  );
}

function MenuAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className="text-ink-2 hover:bg-paper-3 hover:text-ink inline-flex h-10 w-full items-center gap-2.5 rounded-[8px] px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}

function AddressRow({
  label,
  address,
  explorerUrl,
  copied,
  onCopy,
}: {
  label: string;
  address: string;
  explorerUrl?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-muted font-mono text-[11px]">{label}</p>
        <span className="flex items-center gap-1">
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${label} in explorer`}
              className="text-muted hover:bg-paper-4 hover:text-ink inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${label}`}
            className="text-muted hover:bg-paper-4 hover:text-ink inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          >
            {copied ? (
              <Check className="text-ok h-3.5 w-3.5" />
            ) : (
              <ClipboardCopy className="h-3.5 w-3.5" />
            )}
          </button>
        </span>
      </div>
      <p className="text-ink truncate font-mono text-xs" title={address}>
        {address}
      </p>
    </div>
  );
}
