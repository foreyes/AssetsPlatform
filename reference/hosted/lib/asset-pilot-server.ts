import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { createReadOnlyStorage } from '@/lib/asset-storage-readonly.mjs';
import release from '@/lib/generated/asset-pilot.json';
// The immutable release retains its original identity and storage keys.
// No visitor, including the owner, receives a storage write operation.
const handle = createReadOnlyStorage({ release, getUser: getChatGPTUser });
export const pilotBase = release.base;
export const pilotRequest = (request: Request) => handle(request, env);
