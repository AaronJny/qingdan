import{test}from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{operationHash,operationKey,readOperation,recordOperation}from'./operations.ts';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE operation_receipts(user_id TEXT,id TEXT,request_hash TEXT,result TEXT,created_at TEXT,PRIMARY KEY(user_id,id));CREATE TABLE records(id TEXT PRIMARY KEY,mutation_id TEXT)');
 const db={
  prepare(sql:string){
   return {bind(...args:any[]){
    return {
     async first(){return sqlite.prepare(sql).get(...args)||null},
     async run(){const result=sqlite.prepare(sql).run(...args);return{meta:{changes:Number(result.changes)}}}
    };
   }};
  }
 }as unknown as D1Database;
 return{sqlite,db};
}

test('operation receipt returns same successful result on identical retry',async()=>{const{db}=fixture();const key=operationKey('import','stable-client-op'),hash=await operationHash({records:[{title:'sample'}]});assert.equal(await readOperation(db,'owner',key,hash),null);await recordOperation(db,'owner',key,hash,{count:3}).run();assert.deepEqual(await readOperation(db,'owner',key,hash),{count:3})});
test('different operations stay separate and guarded receipt is written only after successful record',async()=>{const{db,sqlite}=fixture();const hash=await operationHash({title:'sample'});const key=operationKey('create','id1');assert.equal((await recordOperation(db,'owner',key,hash,{recordId:'id1'},{id:'id1',mutation:'token'}).run()).meta.changes,0);sqlite.prepare('INSERT INTO records(id,mutation_id)VALUES(?,?)').run('id1','token');assert.equal((await recordOperation(db,'owner',key,hash,{recordId:'id1'},{id:'id1',mutation:'token'}).run()).meta.changes,1);assert.deepEqual(await readOperation(db,'owner',key,hash),{recordId:'id1'});assert.equal(await readOperation(db,'owner',operationKey('create','id2'),hash),null)});
test('receipt is atomic with transaction rollback on duplicate client operation',async()=>{const{db,sqlite}=fixture();const key=operationKey('import','op'),hash=await operationHash({file:'sample'});await recordOperation(db,'owner',key,hash,{count:1}).run();sqlite.exec('BEGIN');try{sqlite.prepare('INSERT INTO records(id,mutation_id)VALUES(?,?)').run('new','new-op');await recordOperation(db,'owner',key,hash,{count:1}).run();sqlite.exec('COMMIT')}catch{sqlite.exec('ROLLBACK')}assert.equal(sqlite.prepare('SELECT id FROM records WHERE id=?').get('new'),undefined);assert.deepEqual(await readOperation(db,'owner',key,hash),{count:1})});
