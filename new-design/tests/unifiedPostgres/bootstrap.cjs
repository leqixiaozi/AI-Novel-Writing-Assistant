const runtime=require('../../dist/server/database/runtime');
const {createCheckedPool}=require('./connection.cjs');
let pool;
// Loaded only by an explicitly selected node --require test command. Production
// runtime is not changed; direct startup/status/shutdown remains prohibited.
runtime.getNewDesignPool=()=>pool??=createCheckedPool();
for(const name of ['getDatabaseRuntimeStatus','getPrivateRuntimeStatus','getPrivateRuntimeDiagnostics','stopNewDesignDatabase']){
  if(name in runtime)runtime[name]=async()=>{throw new Error('Isolated tests cannot start, inspect or stop the developer runtime');};
}
