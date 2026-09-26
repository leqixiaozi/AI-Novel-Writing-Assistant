const test=require('node:test');
const assert=require('node:assert/strict');
const records=require('../dist/server/database/recordCards');
const {readCardLocalSnapshot}=require('../dist/server/database/fieldExtensions/localValues');

test('card local values retain exact version data and omit inactive definitions',async t=>{
  const snapshots=t.mock.method(records,'listRecordCards',async(_db,kind,options)=>{
    assert.equal(kind,'card_version_local_value');
    assert.deepEqual(options,{where:{card_version_id:'version-one'}});
    return [
      {id:'local-one',field_definition_id:'field-one',value:{detail:'原版本内容'}},
      {id:'local-two',field_definition_id:'field-two',value:false},
      {id:'local-three',field_definition_id:'archived-field',value:'不可见'},
    ];
  });
  const db={query:async(sql,parameters)=>{
    assert.match(sql,/scope='card' AND status='active'/);
    assert.deepEqual(parameters,[['field-one','field-two','archived-field']]);
    return {rows:[{id:'field-one',field_key:'notes'},{id:'field-two',field_key:'enabled'}]};
  }};
  assert.deepEqual(await readCardLocalSnapshot(db,'version-one'),[
    {field_key:'notes',value:{detail:'原版本内容'}},{field_key:'enabled',value:false},
  ]);
  assert.equal(snapshots.mock.callCount(),1);
});

test('empty local snapshot does not query current definitions',async t=>{
  t.mock.method(records,'listRecordCards',async()=>[]);
  assert.deepEqual(await readCardLocalSnapshot({query:async()=>{throw new Error('unexpected query');}},'version-one'),[]);
});
