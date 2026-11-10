import TripWorkspace from '@/components/TripWorkspace';
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripWorkspace tripId={tripId}/>;
}
