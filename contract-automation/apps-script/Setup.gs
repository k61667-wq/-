/**
 * Setup.gs — 최초 1회 실행: 시트 탭 자동 생성 + 트리거 설치 + 설정 점검
 * ==================================================================
 * 배포 순서는 docs/02_배포가이드.md 참고. 편의 함수 3개 제공.
 */

/** (1) 시트 탭과 헤더를 자동 생성. 이미 있으면 건너뜀 */
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defs = {
    'SalesReps':    ['rep_id','name','phone','email','department','active'],
    'Packages':     ['package_id','package_name','duration_months','list_supply','discount','net_supply','vat','contract_total','active'],
    'PackageItems': ['package_id','package_name','item_name','spec','qty','unit','unit_price','amount','description'],
    'Customers':    ['customer_id','company','ceo','biz_no','address','phone','email'],
    'Contracts':    ['contract_no','created_at','customer_id','company','rep_id','rep_name','package_id','package_name','supply','discount','vat','total','start_date','end_date','sign_date','status','pdf_url','doc_url']
  };
  Object.keys(defs).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, defs[name].length).setValues([defs[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  SpreadsheetApp.getUi().alert('시트 탭 준비 완료. data/ 폴더의 CSV 를 각 탭에 붙여넣으세요.');
}

/** (2) 갱신 알림 일일 트리거 설치 (매일 오전 9시) */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkRenewals') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkRenewals').timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getUi().alert('갱신 알림 트리거를 설치했습니다 (매일 09:00).');
}

/** (3) 설정 점검: 템플릿/폴더 ID, 시트 탭, 데이터 유무 확인 */
function runSetupCheck() {
  var msgs = [];
  try { DriveApp.getFileById(CONFIG.TEMPLATE_DOC_ID); msgs.push('✅ 템플릿 Doc 접근 OK'); }
  catch (e) { msgs.push('❌ TEMPLATE_DOC_ID 확인 필요'); }
  try { DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID); msgs.push('✅ 저장 폴더 접근 OK'); }
  catch (e) { msgs.push('❌ ROOT_FOLDER_ID 확인 필요'); }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(CONFIG.SHEETS).forEach(function (k) {
    var name = CONFIG.SHEETS[k];
    msgs.push((ss.getSheetByName(name) ? '✅' : '❌') + ' 탭 ' + name);
  });
  msgs.push('· 담당자 ' + getReps().length + '명 · 패키지 ' + getPackages().length + '개 · 고객 ' + getCustomers().length + '건');
  SpreadsheetApp.getUi().alert('설정 점검\n\n' + msgs.join('\n'));
}
