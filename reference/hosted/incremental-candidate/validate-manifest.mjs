// Local structural preflight only; full file/content/catalog validation remains hosted.
import {validateManifest,LIMITS} from './manifest-contract.mjs';
try {
 let length=0;const chunks=[];
 for await(const chunk of process.stdin){length+=chunk.length;if(length>LIMITS.manifestBytes)throw Error('ingest-budget');chunks.push(chunk)}
 await validateManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}catch(error){process.stderr.write(`Invalid hosted manifest: ${error.message}\n`);process.exitCode=1}
