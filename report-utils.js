'use strict';
// User-controlled ChatGPT titles can begin with spreadsheet formulas. CSV
// quoting alone does NOT prevent spreadsheet formula execution on import.
const AutopilotReportUtils=(()=>{
  function cleanCsv(value) {
    const text=String(value ?? '').replace(/[\x00-\x1f\x7f]/g,' ');
    const trimmed=text.replace(/^[\s\u200b\uFEFF]+/u,'');
    const safe=/^[=+\-@]/u.test(trimmed)?`'${text}`:text;
    return `"${safe.replace(/"/g,'""')}"`;
  }
  return {cleanCsv};
})();
if(typeof module!=='undefined')module.exports=AutopilotReportUtils;
