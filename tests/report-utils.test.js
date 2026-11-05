'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cleanCsv}=require('../report-utils.js');
test('CSV export prevents formula execution via untrusted ChatGPT tab titles',()=>{
  for(const input of ['=HYPERLINK("https://example.test")','+SUM(1,1)','-1+2','@SUM(1,1)','  =1+1','\t=1+1','\uFEFF=1+1']){
    const value=cleanCsv(input);
    assert.match(value,/^"'/,`formula-like CSV field: ${JSON.stringify(input)}`);
  }
});
test('CSV export quotes delimiters, quotes and strips control characters',()=>{
  assert.equal(cleanCsv('hello,"world"'),'"hello,""world"""');
  assert.equal(cleanCsv('line\nnext'),'"line next"');
  assert.equal(cleanCsv('normal'), '"normal"');
  assert.equal(cleanCsv(null),'""');
});
