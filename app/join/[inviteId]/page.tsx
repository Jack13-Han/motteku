import TripJoin from '@/components/TripJoin';
export default async function JoinPage({ params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  return <TripJoin inviteId={inviteId}/>;
}
