import { PoolLpersTable } from "@/components/pool-lpers-table";

export default async function PoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ protocol?: string }>;
}) {
  const { address } = await params;
  const { protocol } = await searchParams;

  return <PoolLpersTable address={address} protocol={protocol} />;
}
