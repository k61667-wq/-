/**
 * Dates.gs — 날짜/계약번호 유틸 (Asia/Seoul 기준)
 */
var TZ = 'Asia/Seoul';

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 'yyyy-MM-dd' 문자열 → Date */
function parseDate(s) {
  if (s instanceof Date) return s;
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** Date → '2025.07.01' */
function fmtDot(d) { return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()); }
/** Date → '2025년 7월 1일' */
function fmtKo(d) { return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
/** Date → 'yyyyMMdd' */
function fmtCompact(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }

/** 시작일 + 개월 → 종료일(마지막 날). 예: 7/1 + 12개월 → 다음해 6/30 */
function addMonthsEnd(start, months) {
  var d = new Date(start.getFullYear(), start.getMonth() + Number(months), start.getDate());
  d.setDate(d.getDate() - 1);
  return d;
}

/** 계약기간 표시 문자열 '2025.07.01 ~ 2026.06.30 (12개월)' */
function periodLabel(start, end, months) {
  return fmtDot(start) + ' ~ ' + fmtDot(end) + ' (' + months + '개월)';
}

/**
 * 계약번호 생성: CW-YYYYMMDD-####
 * 같은 날 이미 생성된 계약 수 +1 을 4자리 시퀀스로.
 */
function nextContractNo(signDate) {
  var datePart = fmtCompact(signDate);
  var rows = sheetToObjects(CONFIG.SHEETS.CONTRACTS);
  var sameDay = rows.filter(function (r) {
    return String(r.contract_no).indexOf(CONFIG.CONTRACT_PREFIX + '-' + datePart) === 0;
  });
  var seq = ('000' + (sameDay.length + 1)).slice(-4); // 4자리 시퀀스
  return CONFIG.CONTRACT_PREFIX + '-' + datePart + '-' + seq;
}
