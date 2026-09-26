const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveDependencyRequestJob}=require('../dist/server/dependencies/outboxReceipt');

const job={specializedRequestId:'request-1',bookId:'book-1',executionGeneration:1};
const source={id:'request-1',book_id:'book-1',status:'pending',strategy_key:'manual_review',receipt_id:null,receipt_outcome:null,output_hash:null};

test('manual dependency review stays pending in its source ledger without executing recompute',()=>{
  const result=resolveDependencyRequestJob(job,source);
  assert.equal(result.outcome,'business_rejected');
  assert.equal(result.resultMetadata.reason,'manual_review_required');
});

test('dependency receipt requires exact book and applied output',()=>{
  assert.throws(()=>resolveDependencyRequestJob(job,{...source,book_id:'another-book'}));
  assert.throws(()=>resolveDependencyRequestJob(job,{...source,status:'completed'}));
  const result=resolveDependencyRequestJob(job,{...source,status:'completed',receipt_id:'receipt-1',receipt_outcome:'applied',output_hash:'hash-1'});
  assert.equal(result.outcome,'applied');
  assert.equal(result.specializedResultId,'receipt-1');
});
