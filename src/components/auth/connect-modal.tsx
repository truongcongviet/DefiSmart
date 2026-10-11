"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCopy,
  ExternalLink,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuthFlow } from "@/components/auth/auth-flow-provider";
import { NetworkMark } from "@/components/auth/network-mark";
import { TokenList } from "@/components/token-mark";
import { shortAddress } from "@/lib/auth/account";
import { type AccountNetwork, NETWORK_LIST, NETWORKS } from "@/lib/chains";
import { button, helperSlot, input } from "@/lib/ui";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export function ConnectModal() {
  const { modal, closeConnect, provisioning } = useAuthFlow();
  const locked =
    modal.step === "provisioning" && provisioning.status === "creating";

  useEffect(() => {
    if (!modal.open) {
      return;
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !locked) {
        closeConnect();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [closeConnect, locked, modal.open]);

  if (!modal.open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[60] grid grid-cols-[minmax(0,1fr)] items-end justify-items-center bg-[oklch(10%_0.02_250/0.72)] p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) {
          closeConnect();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
        className="modal-panel rounded-t-card border-rule bg-paper-2 sm:rounded-card relative w-full max-w-[26rem] border p-6 shadow-[0_32px_80px_-32px_oklch(0%_0_0/0.8)]"
      >
        {!locked && (
          <button
            type="button"
            onClick={closeConnect}
            aria-label="Close"
            className="text-muted hover:bg-paper-3 hover:text-ink absolute top-4 right-4 inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {modal.step === "method" && <MethodStep />}
        {modal.step === "email-code" && <EmailCodeStep />}
        {modal.step === "network" && <NetworkStep />}
        {modal.step === "provisioning" && <ProvisioningStep />}
        {modal.step === "ready" && <ReadyStep />}
        {modal.step === "error" && <ErrorStep />}
      </div>
    </div>
  );
}

function StepHeader({
  eyebrow,
  title,
  description,
  onBack,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  onBack?: () => void;
}) {
  return (
    <div className="mb-6 flex flex-col pr-10">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-muted hover:text-ink mb-4 inline-flex w-fit items-center gap-1 font-mono text-xs transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      ) : (
        <p className="eyebrow mb-3">{eyebrow}</p>
      )}
      <h2
        id="connect-modal-title"
        className="text-ink text-2xl font-light tracking-tight"
      >
        {title}
      </h2>
      {description && (
        <p className="text-ink-2 mt-2 text-sm leading-6">{description}</p>
      )}
    </div>
  );
}

function Helper({ error, hint }: { error?: string | null; hint?: string }) {
  return (
    <p
      role={error ? "alert" : undefined}
      className={cn(helperSlot, "mt-2", error ? "text-danger" : "text-muted")}
    >
      {error ?? hint ?? ""}
    </p>
  );
}

function MethodStep() {
  const { modal, loginWithWallet, email } = useAuthFlow();
  const [address, setAddress] = useState(email.address ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const sending = email.state.status === "sending-code";
  const valid = EMAIL_PATTERN.test(address.trim());

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (!valid || sending) {
      return;
    }

    setLocalError(null);

    try {
      await email.sendCode(address.trim().toLowerCase());
    } catch (error) {
      setLocalError(
        error instanceof Error && error.message
          ? error.message
          : "The code could not be sent. Check the address and try again.",
      );
    }
  }

  return (
    <>
      <StepHeader
        eyebrow="Sign in"
        title="Choose how to sign in."
        description="A wallet or an email. New accounts get an agent wallet right away."
      />

      <div className="divide-rule bg-paper-3/60 divide-y overflow-hidden rounded-[10px]">
        {NETWORK_LIST.map((network) => (
          <button
            key={network.id}
            type="button"
            onClick={() => loginWithWallet(network.id)}
            className="group hover:bg-paper-3 flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors"
          >
            <NetworkMark network={network.id} className="h-10 w-10" />
            <span className="min-w-0 flex-1">
              <span className="text-ink block text-sm font-medium">
                {network.label} wallet
              </span>
              <span className="text-muted block truncate font-mono text-[11px]">
                {network.walletHint}
              </span>
            </span>
            <ArrowRight className="text-muted group-hover:text-accent h-4 w-4 transition-[transform,color] duration-200 group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="bg-rule h-px flex-1" />
        <span className="text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
          or
        </span>
        <span className="bg-rule h-px flex-1" />
      </div>

      <form onSubmit={onSubmit} noValidate>
        <label
          htmlFor="connect-email"
          className="text-muted mb-1.5 block font-mono text-[11px]"
        >
          Email address
        </label>
        <div className="flex gap-2">
          <input
            id="connect-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-invalid={Boolean(localError) || undefined}
            className={input}
          />
          <button
            type="submit"
            disabled={!valid || sending}
            aria-disabled={!valid || sending || undefined}
            className={cn(button.base, button.primary, "px-4")}
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Send code
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
        <Helper
          error={localError ?? modal.error}
          hint="We email a six-digit code. No password."
        />
      </form>

      <p className="text-muted mt-4 font-mono text-[11px] leading-5">
        Extension, WalletConnect QR and in-wallet mobile browsers all work.
        Sessions last 7 days.
      </p>
    </>
  );
}

function EmailCodeStep() {
  const { email, goToStep, modal } = useAuthFlow();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [localError, setLocalError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const submitting = email.state.status === "submitting-code";
  const code = digits.join("");

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1_000,
    );

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(value: string) {
    if (value.length !== CODE_LENGTH || submitting) {
      return;
    }

    setLocalError(null);

    try {
      await email.verifyCode(value);
    } catch (error) {
      setLocalError(
        error instanceof Error && error.message
          ? error.message
          : "That code did not match. Five attempts per code; request a new one if needed.",
      );
      setDigits(Array(CODE_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    }
  }

  function updateDigit(index: number, raw: string) {
    const value = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = value;
    setDigits(next);

    if (value && index < CODE_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }

    const joined = next.join("");

    if (joined.length === CODE_LENGTH) {
      void submit(joined);
    }
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }

    if (event.key === "Enter") {
      void submit(code);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, CODE_LENGTH);

    if (!pasted) {
      return;
    }

    event.preventDefault();
    const next = Array(CODE_LENGTH)
      .fill("")
      .map((_, index) => pasted[index] ?? "");
    setDigits(next);
    inputsRef.current[Math.min(pasted.length, CODE_LENGTH) - 1]?.focus();

    if (pasted.length === CODE_LENGTH) {
      void submit(pasted);
    }
  }

  async function resend() {
    if (cooldown > 0 || !email.address) {
      return;
    }

    setLocalError(null);

    try {
      await email.sendCode(email.address);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setDigits(Array(CODE_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    } catch (error) {
      setLocalError(
        error instanceof Error && error.message
          ? error.message
          : "The code could not be resent.",
      );
    }
  }

  return (
    <>
      <StepHeader
        eyebrow="Sign in"
        title="Enter the six-digit code."
        description={`Sent to ${email.address ?? "your email"}. It expires in a few minutes.`}
        onBack={() => goToStep("method")}
      />

      <div className="flex justify-between gap-2" onPaste={onPaste}>
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              inputsRef.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={digit}
            disabled={submitting}
            aria-label={`Digit ${index + 1}`}
            aria-invalid={Boolean(localError) || undefined}
            onChange={(event) => updateDigit(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
            className={cn(
              input,
              "tnum h-14 px-0 text-center font-mono text-xl",
              digit && "border-rule-2",
            )}
          />
        ))}
      </div>
      <Helper
        error={localError ?? modal.error}
        hint="Paste the whole code to fill every box."
      />

      <button
        type="button"
        onClick={() => void submit(code)}
        disabled={code.length !== CODE_LENGTH || submitting}
        aria-disabled={code.length !== CODE_LENGTH || submitting || undefined}
        className={cn(button.base, button.primary, "mt-3 w-full")}
      >
        {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
        Verify code
      </button>

      <div className="text-muted mt-4 flex items-center justify-between font-mono text-xs">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={cooldown > 0 || email.state.status === "sending-code"}
          aria-disabled={cooldown > 0 || undefined}
          className="tnum hover:text-ink transition-colors disabled:cursor-not-allowed disabled:opacity-55"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
        <button
          type="button"
          onClick={() => goToStep("method")}
          className="hover:text-ink transition-colors"
        >
          Use another email
        </button>
      </div>
    </>
  );
}

function NetworkStep() {
  const { chooseNetwork, modal } = useAuthFlow();
  const [pending, setPending] = useState<AccountNetwork | null>(null);

  async function pick(network: AccountNetwork) {
    setPending(network);

    try {
      await chooseNetwork(network);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <StepHeader
        eyebrow="Step 2 of 3"
        title="Choose a network."
        description="Each account is bound to one network. The agent wallet is created there and positions can only be opened on it."
      />

      <div className="divide-rule bg-paper-3/60 divide-y overflow-hidden rounded-[10px]">
        {NETWORK_LIST.map((network) => (
          <button
            key={network.id}
            type="button"
            disabled={pending !== null}
            aria-disabled={pending !== null || undefined}
            onClick={() => void pick(network.id)}
            className="group hover:bg-paper-3 flex w-full items-start gap-3 px-3.5 py-3.5 text-left transition-colors disabled:cursor-wait disabled:opacity-55"
          >
            <NetworkMark network={network.id} className="mt-0.5 h-10 w-10" />
            <span className="min-w-0 flex-1">
              <span className="text-ink flex items-center gap-2 text-sm font-medium">
                {network.label}
                {pending === network.id && (
                  <LoaderCircle className="text-accent h-3.5 w-3.5 animate-spin" />
                )}
              </span>
              <span className="text-muted mt-0.5 block font-mono text-[11px]">
                {network.protocols}
              </span>
              <span className="text-ink-2 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5">
                <span>Fund with</span>
                <TokenList
                  tokens={network.fundingTokenList}
                  markClassName="h-4 w-4"
                />
                <span>· start with about {network.recommendedDeposit}.</span>
              </span>
            </span>
            <ArrowRight className="text-muted group-hover:text-accent mt-3 h-4 w-4 transition-[transform,color] duration-200 group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
      <Helper error={modal.error} />
    </>
  );
}

function ProvisioningStep() {
  const { provisioning } = useAuthFlow();
  const network = provisioning.network ? NETWORKS[provisioning.network] : null;

  return (
    <div className="flex flex-col py-4">
      <p className="eyebrow mb-3">Step 3 of 3</p>
      <h2
        id="connect-modal-title"
        className="text-ink text-2xl font-light tracking-tight"
      >
        Creating the agent wallet.
      </h2>
      <p className="text-ink-2 mt-2 text-sm leading-6">
        {network
          ? `A separate ${network.label} wallet is being provisioned. Positions will open from it, so you will not sign each transaction.`
          : "A separate wallet is being provisioned for your positions."}
      </p>
      <div className="bg-paper-3/60 text-muted mt-6 flex items-center gap-3 rounded-[10px] px-3.5 py-3 font-mono text-xs">
        <LoaderCircle className="text-accent h-4 w-4 animate-spin" />
        Waiting for the key service…
      </div>
    </div>
  );
}

function ReadyStep() {
  const { provisioning, account, closeConnect } = useAuthFlow();
  const [copied, setCopied] = useState(false);
  const network = provisioning.network ?? account?.network ?? null;
  const info = network ? NETWORKS[network] : null;
  const address = provisioning.address ?? account?.agentWallet?.address ?? null;

  async function copy() {
    if (!address) {
      return;
    }

    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <>
      <StepHeader
        eyebrow="Ready"
        title="Agent wallet created."
        description={
          info
            ? `This account is bound to ${info.label}. Positions open from the address below.`
            : "Your account is ready."
        }
      />

      {address && info && (
        <div className="bg-paper-3/60 rounded-[10px] px-3.5 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-muted inline-flex items-center gap-2 font-mono text-[11px]">
              <NetworkMark network={info.id} className="h-5 w-5 text-[8px]" />
              Agent wallet · {info.label}
            </span>
            <span className="flex items-center gap-1">
              <a
                href={info.explorerAddressUrl(address)}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in explorer"
                className="text-muted hover:bg-paper-4 hover:text-ink inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => void copy()}
                aria-label="Copy address"
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
          <p className="text-ink truncate font-mono text-sm" title={address}>
            {shortAddress(address, 10)}
          </p>
        </div>
      )}

      {info && (
        <p className="text-ink-2 mt-4 text-xs leading-5">
          Deposit{" "}
          <TokenList
            tokens={info.fundingTokenList}
            markClassName="h-4 w-4"
            className="align-middle"
          />{" "}
          to this address to start. Keep a reserve for fees and position rent;
          about {info.recommendedDeposit} is a sensible minimum. Export the
          private key or withdraw at any time from the account menu.
        </p>
      )}

      <button
        type="button"
        onClick={closeConnect}
        className={cn(button.base, button.primary, "mt-6 w-full")}
      >
        Go to the app
      </button>
    </>
  );
}

function ErrorStep() {
  const { provisioning, retryProvisioning, closeConnect } = useAuthFlow();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);

    try {
      await retryProvisioning();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <StepHeader
        eyebrow="Needs attention"
        title="The agent wallet was not created."
        description="You are signed in. The key service did not finish creating the wallet, so positions cannot open yet."
      />
      <Helper error={provisioning.error} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          aria-disabled={retrying || undefined}
          className={cn(button.base, button.primary, "flex-1")}
        >
          {retrying && <LoaderCircle className="h-4 w-4 animate-spin" />}
          Create it again
        </button>
        <button
          type="button"
          onClick={closeConnect}
          className={cn(button.base, button.outline, "flex-1")}
        >
          Later
        </button>
      </div>
    </>
  );
}
