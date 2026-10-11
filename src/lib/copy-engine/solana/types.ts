export interface SolanaParsedAccountKey {
  pubkey: string;
  signer: boolean;
  writable: boolean;
  source?: "transaction" | "lookupTable";
}

export interface SolanaParsedInstruction {
  program?: string;
  programId?: string;
  parsed?: unknown;
  accounts?: string[];
  data?: string;
}

export interface SolanaTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount?: number | null;
    uiAmountString?: string;
  };
}

export interface SolanaRpcTransaction {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: {
      header?: {
        numRequiredSignatures: number;
        numReadonlySignedAccounts: number;
        numReadonlyUnsignedAccounts: number;
      };
      accountKeys: Array<string | SolanaParsedAccountKey>;
      instructions: SolanaParsedInstruction[];
      recentBlockhash?: string;
    };
  };
  meta: null | {
    err: unknown | null;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: SolanaTokenBalance[] | null;
    postTokenBalances?: SolanaTokenBalance[] | null;
    innerInstructions?: Array<{
      index: number;
      instructions: SolanaParsedInstruction[];
    }> | null;
    logMessages?: string[] | null;
  };
  version?: "legacy" | number;
}
