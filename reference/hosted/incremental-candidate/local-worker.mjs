// Test fixture ONLY. Never used by app/mcp/route.ts or production build.
import release from '../lib/generated/asset-pilot.json';
import {createPilotMCP} from '../lib/asset-pilot-mcp.mjs';
import {createIncrementalStorage} from './storage.mjs';
const storage=createIncrementalStorage();
export default {async fetch(request,env){if(env.LOCAL_FIXTURE_ONLY!=='synthetic')return new Response('Local fixture disabled',{status:503});if(new URL(request.url).pathname==='/mcp'){const handle=createPilotMCP({release,incrementalStorage:storage,getUser:async()=>request.headers.get('X-Local-Fixture-User')?{userId:request.headers.get('X-Local-Fixture-User')}:null});return handle(request,env)}return await storage.read(request,env)||new Response('Not found',{status:404})}};
