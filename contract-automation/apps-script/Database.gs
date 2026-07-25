/**
 * Database.gs — Google Sheets 를 데이터베이스처럼 읽는 얇은 계층
 * ------------------------------------------------------------------
 * 모든 탭은 1행이 헤더(컬럼명)라고 가정합니다.
 * sheetToObjects() 하나로 어떤 탭이든 [{컬럼:값}, ...] 배열로 변환합니다.
 */

/** 지정한 탭을 객체 배열로 반환 */
function sheetToObjects(sheetName) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) throw new Error('시트 탭을 찾을 수 없습니다: ' + sheetName);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;             // 빈 줄 skip
    var obj = {};
    for (var c = 0; c < head.length; c++) obj[head[c]] = row[c];
    rows.push(obj);
  }
  return rows;
}

/** 활성(active=TRUE) 담당자 목록 */
function getReps() {
  return sheetToObjects(CONFIG.SHEETS.REPS).filter(function (r) {
    return String(r.active).toUpperCase() !== 'FALSE';
  });
}

/** 활성 패키지 헤더 목록 */
function getPackages() {
  return sheetToObjects(CONFIG.SHEETS.PACKAGES).filter(function (p) {
    return String(p.active).toUpperCase() !== 'FALSE';
  });
}

/** 특정 패키지의 구성 라인(8개 항목) */
function getPackageItems(packageId) {
  return sheetToObjects(CONFIG.SHEETS.PKG_ITEMS).filter(function (i) {
    return i.package_id === packageId;
  });
}

/** 고객 목록 */
function getCustomers() {
  return sheetToObjects(CONFIG.SHEETS.CUSTOMERS);
}

function findRep(id)      { return getReps().filter(function (x){return x.rep_id===id;})[0]; }
function findPackage(id)  { return getPackages().filter(function (x){return x.package_id===id;})[0]; }
function findCustomer(id) { return getCustomers().filter(function (x){return x.customer_id===id;})[0]; }
