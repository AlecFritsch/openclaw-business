import { redirect } from "next/navigation";

export default async function LogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/agents/${id}/settings`);
}
