/**
 * Renewals.gs — 계약 만료 갱신 알림 (일 1회 트리거)
 * ==================================================================
 * Contracts 시트의 end_date 가 오늘로부터 RENEWAL_NOTICE_DAYS 이내이고
 * 아직 '갱신알림' 상태가 아닌 계약을 담당자에게 메일로 알린다.
 */
function checkRenewals() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEETS.CONTRACTS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  var head = values[0];
  var col = {};
  head.forEach(function (h, i) { col[String(h).trim()] = i; });

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var limit = new Date(today); limit.setDate(limit.getDate() + CONFIG.RENEWAL_NOTICE_DAYS);
  var reps = getReps();
  var notified = 0;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var status = String(row[col['status']] || '');
    if (status.indexOf('갱신알림') === 0) continue;
    var endRaw = row[col['end_date']];
    if (!endRaw) continue;
    var end = (endRaw instanceof Date) ? endRaw : parseDate(String(endRaw).replace(/\./g, '-').replace(/-$/, ''));
    if (isNaN(end.getTime())) continue;
    end.setHours(0, 0, 0, 0);

    if (end >= today && end <= limit) {
      var repRow = reps.filter(function (x) { return x.rep_id === row[col['rep_id']]; })[0];
      var to = repRow ? repRow.email : Session.getActiveUser().getEmail();
      if (to) {
        MailApp.sendEmail(to,
          '[갱신예정] ' + row[col['company']] + ' 계약 만료 ' + CONFIG.RENEWAL_NOTICE_DAYS + '일 이내',
          '계약번호 ' + row[col['contract_no']] + '\n고객: ' + row[col['company']] +
          '\n종료일: ' + fmtDot(end) + '\n담당자: ' + row[col['rep_name']] +
          '\n\n갱신 상담을 진행해 주세요.');
        sh.getRange(r + 1, col['status'] + 1).setValue('갱신알림(' + fmtDot(today) + ')');
        notified++;
      }
    }
  }
  return notified;
}
