const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const identity={container:'ai-novel-new-design-test-20260917-unified',database:'new_design_unified_20260917',scope:'unified-20260917',port:55583,image:'ai-novel/new-design-postgres-dev:pg17-age1.7-vector0.8.6'};

/** Test-only guard. Never accepts a developer URL, volume, database or runtime. */
function verifyContainer(){
  const format='{"name":{{json .Name}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}},"ports":{{json .NetworkSettings.Ports}}}';
  const info=JSON.parse(execFileSync('docker',['inspect','--format',format,identity.container],{encoding:'utf8',windowsHide:true,timeout:10000}));
  assert.equal(info.name,`/${identity.container}`);
  assert.equal(info.image,identity.image);
  assert.equal(info.labels['ai-novel.validation'],identity.scope);
  assert.deepEqual(info.mounts,[],'Test container must not mount any volume or host directory');
  assert.ok(info.tmpfs['/var/lib/postgresql/data']);
  assert.deepEqual(info.ports['5432/tcp'],[{HostIp:'127.0.0.1',HostPort:String(identity.port)}]);
}
async function createCheckedPool(){
  verifyContainer();
  const pool=new Pool({host:'127.0.0.1',port:identity.port,database:identity.database,user:'postgres',password:'',max:8,application_name:'new_design_isolated_validation',connectionTimeoutMillis:10000});
  try{
    const row=(await pool.query("SELECT current_database() database,current_setting('new_design.validation_scope',true) scope,current_setting('data_directory') directory,inet_server_port() port")).rows[0];
    assert.equal(row.database,identity.database);assert.equal(row.scope,identity.scope);assert.equal(row.port,5432);
    assert.ok(row.directory==='/var/lib/postgresql/data'||row.directory.startsWith('/var/lib/postgresql/data/'));
    return pool;
  }catch(error){await pool.end();throw error;}
}
exports.identity=identity;exports.createCheckedPool=createCheckedPool;
