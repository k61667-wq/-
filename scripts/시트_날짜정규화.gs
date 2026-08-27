/**
 * 뉴스포스트 관리 시트 — 날짜 텍스트 → 날짜 값 일괄 변환
 *
 * 왜 필요한가
 *   시트 전체의 날짜가 '26.07.18' 형태의 문자열로 들어가 있습니다 (ISO 날짜 0건).
 *   사용 가이드에 적힌 핵심 수식 MAXIFS / MINIFS 는 날짜 '값'에만 동작하고
 *   텍스트에는 빈 값을 돌려줍니다. 그래서 지금
 *     - 마지막 작업일이 48곳 중 1곳만 채워지고
 *     - 지연 판정이 2건밖에 안 나오고
 *     - 이번 주 / 이번 달 완료 수량이 항상 0
 *   입니다. 이 스크립트 1회 실행으로 대시보드 절반이 되살아납니다.
 *
 * 실행 전 반드시
 *   파일 → 사본 만들기 로 백업을 만드십시오. 이 스크립트는 셀 값을 덮어씁니다.
 *
 * 실행 순서
 *   1) previewDateColumns()  — 무엇을 바꿀지 먼저 확인 (아무것도 바꾸지 않음)
 *   2) normalizeAllDates()   — 실제 변환
 *   3) 변환 후 각 열 서식을 '날짜'로 지정 (스크립트가 yyyy-mm-dd 로 설정합니다)
 */

/** 변환 대상: 시트 이름 → 날짜 열 헤더 목록 */
var DATE_TARGETS = [
  { sheet: '뉴스포스트 프로그램', headers: ['등록일', '작성 예정일', '발행 예정일', '발행일'] },
  { sheet: '업체 관리',          headers: ['계약 시작일', '계약 종료일'] },
  { sheet: '뉴스포스트 작성 보고서', headers: ['마지막 작업일', '다음 예정 작업일'] },
  { sheet: '주간 업무 보고',      headers: ['보고 시작일', '보고 종료일'] }
];

/** 헤더가 몇 번째 행에 있는지 모를 수 있으므로 위에서 이 행 수만큼 훑는다 */
var HEADER_SCAN_ROWS = 8;

/** 2자리 연도 해석 기준 — 26 → 2026 */
var CENTURY = 2000;


/** ① 미리보기 — 아무것도 바꾸지 않고 무엇이 바뀔지만 로그로 출력 */
function previewDateColumns() {
  var report = runNormalize_(true);
  SpreadsheetApp.getUi().alert('미리보기 (변경 없음)\n\n' + report);
}

/** ② 실제 변환 */
function normalizeAllDates() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert(
    '날짜 일괄 변환',
    '셀 값을 덮어씁니다. 사본(백업)을 먼저 만드셨습니까?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var report = runNormalize_(false);
  ui.alert('변환 완료\n\n' + report);
}


function runNormalize_(dryRun) {
  var ss = SpreadsheetApp.getActive();
  var lines = [];

  DATE_TARGETS.forEach(function (target) {
    var sh = ss.getSheetByName(target.sheet);
    if (!sh) { lines.push('⚠ 시트 없음: ' + target.sheet); return; }

    var found = findHeaderRow_(sh, target.headers);
    if (!found) { lines.push('⚠ 헤더 못 찾음: ' + target.sheet); return; }

    var headerRow = found.row;
    var lastRow = sh.getLastRow();
    if (lastRow <= headerRow) { lines.push('· ' + target.sheet + ' — 데이터 없음'); return; }

    target.headers.forEach(function (h) {
      var col = found.map[h];
      if (!col) return;

      var range = sh.getRange(headerRow + 1, col, lastRow - headerRow, 1);
      var vals = range.getValues();
      var out = [];
      var converted = 0, already = 0, blank = 0, failed = [];

      for (var i = 0; i < vals.length; i++) {
        var v = vals[i][0];
        if (v === '' || v === null) { out.push(['']); blank++; continue; }
        if (v instanceof Date) { out.push([v]); already++; continue; }
        var d = parseKoreanDate_(v);
        if (d) { out.push([d]); converted++; }
        else { out.push([v]); if (failed.length < 3) failed.push(String(v)); }
      }

      if (!dryRun && converted > 0) {
        range.setValues(out);
        range.setNumberFormat('yyyy-mm-dd');
      }

      lines.push('· ' + target.sheet + ' [' + h + '] ' +
        '변환 ' + converted + ' / 이미 날짜 ' + already + ' / 빈칸 ' + blank +
        (failed.length ? ' / ⚠ 해석실패 ' + failed.join(', ') : ''));
    });
  });

  return lines.join('\n');
}


/** 헤더 행과 각 헤더의 열 번호를 찾는다 */
function findHeaderRow_(sh, headers) {
  var scan = Math.min(HEADER_SCAN_ROWS, sh.getLastRow());
  if (scan < 1) return null;
  var width = sh.getLastColumn();
  var grid = sh.getRange(1, 1, scan, width).getValues();

  for (var r = 0; r < scan; r++) {
    var map = {}, hit = 0;
    for (var c = 0; c < width; c++) {
      var cell = String(grid[r][c]).trim();
      if (headers.indexOf(cell) >= 0 && !map[cell]) { map[cell] = c + 1; hit++; }
    }
    if (hit > 0) return { row: r + 1, map: map };
  }
  return null;
}


/**
 * '26.07.18', '26.7.8', '2026.07.18', '26-07-18', '2026/7/8' 등을 Date로 변환.
 * 해석할 수 없으면 null을 돌려주고 원본을 그대로 둔다 (조용히 망가뜨리지 않는다).
 */
function parseKoreanDate_(v) {
  var s = String(v).trim();
  if (!s) return null;

  var m = s.match(/^(\d{2}|\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})\.?$/);
  if (!m) return null;

  var y = parseInt(m[1], 10);
  var mo = parseInt(m[2], 10);
  var d = parseInt(m[3], 10);

  if (m[1].length === 2) y += CENTURY;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  var dt = new Date(y, mo - 1, d);
  // 2월 30일 같은 값이 3월로 넘어가는 것을 막는다
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}


/** ③ 변환 후 점검 — 되살아났는지 확인 */
function verifyDates() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('뉴스포스트 프로그램');
  if (!sh) { SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다.'); return; }

  var found = findHeaderRow_(sh, ['발행일']);
  if (!found || !found.map['발행일']) { SpreadsheetApp.getUi().alert('발행일 열을 찾을 수 없습니다.'); return; }

  var last = sh.getLastRow();
  var vals = sh.getRange(found.row + 1, found.map['발행일'], last - found.row, 1).getValues();
  var dates = vals.map(function (r) { return r[0]; }).filter(function (v) { return v instanceof Date; });

  if (!dates.length) { SpreadsheetApp.getUi().alert('아직 날짜 값이 없습니다. normalizeAllDates()를 먼저 실행하세요.'); return; }

  dates.sort(function (a, b) { return b - a; });
  var latest = dates[0];
  var gap = Math.floor((new Date() - latest) / 86400000);

  SpreadsheetApp.getUi().alert(
    '날짜 값 ' + dates.length + '건 확인\n' +
    '가장 최근 발행일: ' + Utilities.formatDate(latest, Session.getScriptTimeZone(), 'yyyy-MM-dd') + '\n' +
    '오늘까지 공백: ' + gap + '일' +
    (gap > 7 ? '\n\n🔴 7일을 넘겼습니다. 당근 소식은 최근 1주일 내 글만 노출 후보에 듭니다.' : ''));
}


/**
 * 설치
 *   1) 시트 → 확장 프로그램 → Apps Script
 *   2) 새 파일로 이 코드를 붙여넣고 저장
 *   3) 파일 → 사본 만들기 로 시트 백업
 *   4) previewDateColumns() 실행 → 결과 확인
 *   5) normalizeAllDates() 실행
 *   6) verifyDates() 로 확인
 *
 * 시트 이름이 다르면 DATE_TARGETS 의 sheet 값을 실제 탭 이름으로 바꾸십시오.
 */
