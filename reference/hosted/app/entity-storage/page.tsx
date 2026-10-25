import { redirect } from 'next/navigation';

// Legacy upload-entry links now lead back to the existing read-only catalog.
// Asset ingestion is managed through the authenticated backend publication flow.
export default function StorageLegacyPage() {
  redirect('/entity/');
}
