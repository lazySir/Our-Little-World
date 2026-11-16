import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
const directory=mkdtempSync(path.join(tmpdir(),'little-world-web-'));
const env={...process.env,DATABASE_URL:`file:${path.join(directory,'world.db').replaceAll('\\','/')}`,STORAGE_DIR:path.join(directory,'storage'),ASSET_SECRET:'isolated-web-browser-test-secret-at-least-32',PORT:'3001',HOST:'127.0.0.1',RUST_LOG:'info'};
execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{cwd:root,env,stdio:'pipe'});
const api=spawn(process.execPath,[require.resolve('tsx/cli'),'apps/api/src/main.ts'],{cwd:root,env,stdio:'inherit'});
let web:ReturnType<typeof spawn>|undefined;
function stop(){api.kill();web?.kill();const target=path.resolve(directory);const parent=path.resolve(tmpdir());if(path.dirname(target)===parent&&path.basename(target).startsWith('little-world-web-')){try{rmSync(target,{recursive:true,force:true});}catch{}}process.exit();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:3001/api/health')).ok)break;}catch{}await delay(250);if(i===79)throw new Error('Isolated API did not start');}
web=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5174'],{cwd:path.join(root,'apps/web'),env:{...env,API_PROXY_TARGET:'http://127.0.0.1:3001'},stdio:'inherit'});
api.on('exit',code=>{if(code)process.exitCode=code;web?.kill();});
web.on('exit',code=>{if(code)process.exitCode=code;api.kill();});
