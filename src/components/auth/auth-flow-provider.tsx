"use client";

import {
  type LinkedAccountWithMetadata,
  type OtpFlowState,
  type User,
  useCreateWallet as useCreateEthereumWallet,
  useLogin,
  useLoginWithEmail,
  useLogout,
  usePrivy,
} from "@privy-io/react-auth";
import { useCreateWallet as useCreateSolanaWallet } from "@privy-io/react-auth/solana";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type AccountSummary,
  findAgentWallet,
  summarizeAccount,
} from "@/lib/auth/account";
import { type AccountNetwork, networkFromChainType } from "@/lib/chains";

export type ConnectStep =
  | "method"
  | "email-code"
  | "network"
  | "provisioning"
  | "ready"
  | "error";

export type ProvisionStatus = "idle" | "creating" | "done" | "error";

export interface ServerSessionState {
  configured: boolean;
  expiresAt: number | null;
}

export interface AuthFlowContextValue {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  account: AccountSummary | null;
  /** True when the user is signed in but the agent wallet is still missing. */
  needsSetup: boolean;
  modal: { open: boolean; step: ConnectStep; error: string | null };
  openConnect: () => void;
  closeConnect: () => void;
  goToStep: (step: ConnectStep) => void;
  loginWithWallet: (network: AccountNetwork) => void;
  email: {
    address: string | null;
    state: OtpFlowState;
    sendCode: (address: string) => Promise<void>;
    verifyCode: (code: string) => Promise<void>;
  };
  chooseNetwork: (network: AccountNetwork) => Promise<void>;
  retryProvisioning: () => Promise<void>;
  provisioning: {
    status: ProvisionStatus;
    network: AccountNetwork | null;
    address: string | null;
    error: string | null;
  };
  serverSession: ServerSessionState;
  logout: () => Promise<void>;
}

const UNCONFIGURED: AuthFlowContextValue = {
  configured: false,
  ready: true,
  authenticated: false,
  account: null,
  needsSetup: false,
  modal: { open: false, step: "method", error: null },
  openConnect: () => undefined,
  closeConnect: () => undefined,
  goToStep: () => undefined,
  loginWithWallet: () => undefined,
  email: {
    address: null,
    state: { status: "initial" },
    sendCode: async () => undefined,
    verifyCode: async () => undefined,
  },
  chooseNetwork: async () => undefined,
  retryProvisioning: async () => undefined,
  provisioning: { status: "idle", network: null, address: null, error: null },
  serverSession: { configured: false, expiresAt: null },
  logout: async () => undefined,
};

const AuthFlowContext = createContext<AuthFlowContextValue>(UNCONFIGURED);

export function useAuthFlow() {
  return useContext(AuthFlowContext);
}

export function UnconfiguredAuthFlowProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthFlowContext.Provider value={UNCONFIGURED}>
      {children}
    </AuthFlowContext.Provider>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return fallback;
}

function isExitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");

  return /exited_auth_flow|user_exited|closed/i.test(text);
}

type LoginCompleteParams = {
  user: User;
  isNewUser: boolean;
  wasAlreadyAuthenticated: boolean;
  loginAccount: LinkedAccountWithMetadata | null;
};

/**
 * Orchestrates the login flow on top of Privy:
 * 1. wallet (Privy modal, per network) or email OTP (headless)
 * 2. bind the account to one network
 * 3. create the agent wallet on that network
 * 4. mint a 7-day server session cookie
 */
export function AuthFlowProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { createWallet: createEthereumWallet } = useCreateEthereumWallet();
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet();

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<ConnectStep>("method");
  const [modalError, setModalError] = useState<string | null>(null);
  const [emailAddress, setEmailAddress] = useState<string | null>(null);
  const [provisionStatus, setProvisionStatus] =
    useState<ProvisionStatus>("idle");
  const [provisionNetwork, setProvisionNetwork] =
    useState<AccountNetwork | null>(null);
  const [provisionAddress, setProvisionAddress] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [serverSession, setServerSession] = useState<ServerSessionState>({
    configured: false,
    expiresAt: null,
  });

  const handledLoginRef = useRef<string | null>(null);
  const provisioningRef = useRef(false);

  const account = useMemo(() => summarizeAccount(user), [user]);
  const needsSetup = Boolean(
    ready && authenticated && account && !account.agentWallet,
  );

  const ensureAgentWallet = useCallback(
    async (network: AccountNetwork, currentUser: User | null | undefined) => {
      if (provisioningRef.current) {
        return;
      }

      const existing = findAgentWallet(currentUser, network);

      setProvisionNetwork(network);
      setProvisionError(null);

      if (existing) {
        setProvisionAddress(existing.address);
        setProvisionStatus("done");
        setStep("ready");
        return;
      }

      provisioningRef.current = true;
      setProvisionStatus("creating");
      setStep("provisioning");

      try {
        if (network === "solana") {
          const { wallet } = await createSolanaWallet();
          setProvisionAddress(wallet.address);
        } else {
          const wallet = await createEthereumWallet();
          setProvisionAddress(wallet.address);
        }

        setProvisionStatus("done");
        setStep("ready");
      } catch (error) {
        setProvisionStatus("error");
        setProvisionError(
          errorMessage(error, "Could not create the agent wallet."),
        );
        setStep("error");
      } finally {
        provisioningRef.current = false;
      }
    },
    [createEthereumWallet, createSolanaWallet],
  );

  const handleLoginComplete = useCallback(
    ({
      user: loggedInUser,
      wasAlreadyAuthenticated,
      loginAccount,
    }: LoginCompleteParams) => {
      if (
        wasAlreadyAuthenticated ||
        handledLoginRef.current === loggedInUser.id
      ) {
        return;
      }

      handledLoginRef.current = loggedInUser.id;
      setModalError(null);

      const summary = summarizeAccount(loggedInUser);
      const network =
        summary?.network ??
        (loginAccount?.type === "wallet"
          ? networkFromChainType(loginAccount.chainType)
          : null);

      if (summary?.agentWallet) {
        // Returning account: nothing to provision, close quietly.
        setProvisionStatus("done");
        setProvisionNetwork(summary.network);
        setProvisionAddress(summary.agentWallet.address);
        setModalOpen(false);
        return;
      }

      setModalOpen(true);

      if (network) {
        void ensureAgentWallet(network, loggedInUser);
      } else {
        setStep("network");
      }
    },
    [ensureAgentWallet],
  );

  const handleLoginError = useCallback((error: unknown) => {
    if (isExitError(error)) {
      setModalOpen(true);
      setStep("method");
      return;
    }

    setModalError(errorMessage(error, "Login failed. Please try again."));
    setModalOpen(true);
    setStep("method");
  }, []);

  const { login } = useLogin({
    onComplete: handleLoginComplete,
    onError: handleLoginError,
  });

  const {
    sendCode,
    loginWithCode,
    state: emailState,
  } = useLoginWithEmail({
    onComplete: handleLoginComplete,
    onError: handleLoginError,
  });

  const { logout: privyLogout } = useLogout();

  const openConnect = useCallback(() => {
    setModalError(null);

    if (authenticated && account) {
      if (account.agentWallet) {
        setStep("ready");
      } else if (account.network) {
        void ensureAgentWallet(account.network, user);
      } else {
        setStep("network");
      }
    } else {
      setStep("method");
    }

    setModalOpen(true);
  }, [account, authenticated, ensureAgentWallet, user]);

  const closeConnect = useCallback(() => {
    setModalOpen(false);
    setModalError(null);
  }, []);

  const loginWithWallet = useCallback(
    (network: AccountNetwork) => {
      setModalError(null);
      // Hide our modal so the Privy wallet picker is the only dialog on screen.
      setModalOpen(false);
      login({
        loginMethods: ["wallet"],
        walletChainType: network === "solana" ? "solana-only" : "ethereum-only",
      });
    },
    [login],
  );

  const sendEmailCode = useCallback(
    async (address: string) => {
      setModalError(null);
      await sendCode({ email: address });
      setEmailAddress(address);
      setStep("email-code");
    },
    [sendCode],
  );

  const verifyEmailCode = useCallback(
    async (code: string) => {
      setModalError(null);
      await loginWithCode({ code });
    },
    [loginWithCode],
  );

  const chooseNetwork = useCallback(
    async (network: AccountNetwork) => {
      await ensureAgentWallet(network, user);
    },
    [ensureAgentWallet, user],
  );

  const retryProvisioning = useCallback(async () => {
    const network = provisionNetwork ?? account?.network;

    if (!network) {
      setStep("network");
      return;
    }

    await ensureAgentWallet(network, user);
  }, [account?.network, ensureAgentWallet, provisionNetwork, user]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => null);
    await privyLogout();
    handledLoginRef.current = null;
    setModalOpen(false);
    setStep("method");
    setEmailAddress(null);
    setProvisionStatus("idle");
    setProvisionNetwork(null);
    setProvisionAddress(null);
    setProvisionError(null);
    setServerSession({ configured: false, expiresAt: null });
  }, [privyLogout]);

  // Keep the 7-day server session in sync with the Privy session.
  const sessionNetwork = account?.network ?? null;
  const sessionUserId = account?.userId ?? null;

  useEffect(() => {
    if (!ready || !authenticated || !sessionUserId) {
      return;
    }

    let cancelled = false;

    (async () => {
      const accessToken = await getAccessToken();

      if (!accessToken || cancelled) {
        return;
      }

      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, network: sessionNetwork }),
      }).catch(() => null);

      if (!response || cancelled) {
        return;
      }

      if (response.status === 503) {
        setServerSession({ configured: false, expiresAt: null });
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        session?: { expiresAt?: number } | null;
      } | null;

      setServerSession({
        configured: true,
        expiresAt: data?.session?.expiresAt ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken, ready, sessionNetwork, sessionUserId]);

  const value = useMemo<AuthFlowContextValue>(
    () => ({
      configured: true,
      ready,
      authenticated,
      account,
      needsSetup,
      modal: { open: modalOpen, step, error: modalError },
      openConnect,
      closeConnect,
      goToStep: setStep,
      loginWithWallet,
      email: {
        address: emailAddress,
        state: emailState,
        sendCode: sendEmailCode,
        verifyCode: verifyEmailCode,
      },
      chooseNetwork,
      retryProvisioning,
      provisioning: {
        status: provisionStatus,
        network: provisionNetwork,
        address: provisionAddress,
        error: provisionError,
      },
      serverSession,
      logout,
    }),
    [
      account,
      authenticated,
      chooseNetwork,
      closeConnect,
      emailAddress,
      emailState,
      loginWithWallet,
      logout,
      modalError,
      modalOpen,
      needsSetup,
      openConnect,
      provisionAddress,
      provisionError,
      provisionNetwork,
      provisionStatus,
      ready,
      retryProvisioning,
      sendEmailCode,
      serverSession,
      step,
      verifyEmailCode,
    ],
  );

  return (
    <AuthFlowContext.Provider value={value}>
      {children}
    </AuthFlowContext.Provider>
  );
}
