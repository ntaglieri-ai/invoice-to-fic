import { InvoiceDashboard } from "@/components/invoice-dashboard";

// Render the month controls for the current request, not the deployment date.
export const dynamic = "force-dynamic";

export default function Home() {
  return <InvoiceDashboard />;
}
