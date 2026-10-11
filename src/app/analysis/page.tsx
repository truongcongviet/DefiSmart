import { AddressAnalysis } from "@/components/address-analysis";

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const { owner } = await searchParams;

  return <AddressAnalysis initialOwner={owner ?? ""} />;
}
