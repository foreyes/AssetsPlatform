import { getChatGPTUser } from '@/app/chatgpt-auth';
import { createNativeSampleHandler } from '@/lib/native-asset-sample.mjs';
import sample from '@/lib/generated/native-asset-sample.json';
import { pilotBase, pilotRequest } from '@/lib/asset-pilot-server';
const read = createNativeSampleHandler({sample, getUser:getChatGPTUser});
const route = (request: Request) => new URL(request.url).pathname.startsWith(pilotBase + '/') ? pilotRequest(request) : read(request);
export const dynamic = 'force-dynamic';
export const GET = route;
export const HEAD = route;
