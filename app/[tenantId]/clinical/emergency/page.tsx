import { GovernedEmergencyConsole } from '@/components/emergency/governed-emergency-console';

export const dynamic = 'force-dynamic';

/**
 * Direct Emergency Department intake entry point.
 * The console uses only authenticated tenant projections and server commands.
 */
export default function EmergencyIntakePage() {
  return <GovernedEmergencyConsole />;
}
