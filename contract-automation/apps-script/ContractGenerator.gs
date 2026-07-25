/**
 * ContractGenerator.gs — Docs 병합 · PDF 변환 · Drive 저장 · 이메일
 * ==================================================================
 */

/**
 * 템플릿 복사 → 변수 치환 → PDF 변환 → Drive(연/월/고객) 저장
 * @return {{docUrl, pdfUrl, folderUrl, pdfBlob, docFile, pdfFile}}
 */
function generateDocuments(contractNo, customer, pkg, startDate, vars) {
  // 1) 저장 폴더 구조:  ROOT / YYYY / YYYY-MM /
  var root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  var yearF  = getOrCreateFolder(root, String(startDate.getFullYear()));
  var monthF = getOrCreateFolder(yearF, startDate.getFullYear() + '-' + pad2(startDate.getMonth() + 1));

  // 2) 파일명:  CW-YYYYMMDD-####_고객상호_패키지
  var safeCompany = String(customer.company || '고객').replace(/[\\/:*?"<>|]/g, ' ').trim();
  var baseName = contractNo + '_' + safeCompany + '_' + pkg.name;

  // 3) 템플릿 복사 → 새 Doc
  var templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_DOC_ID);
  var docFile = templateFile.makeCopy(baseName, monthF);
  var doc = DocumentApp.openById(docFile.getId());
  var body = doc.getBody();

  // 4) 변수 치환 (본문/머리말/꼬리말 모두)
  var sections = [body];
  if (doc.getHeader()) sections.push(doc.getHeader());
  if (doc.getFooter()) sections.push(doc.getFooter());
  Object.keys(vars).forEach(function (key) {
    var val = vars[key] == null ? '' : String(vars[key]);
    sections.forEach(function (sec) { sec.replaceText(escapeRegex(key), val); });
  });
  trimEmptyServiceRows(body);   // 패키지별 항목 수 차이 → 빈 줄 제거
  doc.saveAndClose();

  // 5) PDF 변환
  var pdfBlob = docFile.getAs('application/pdf').setName(baseName + '.pdf');
  var pdfFile = monthF.createFile(pdfBlob);

  return {
    docUrl: docFile.getUrl(),
    pdfUrl: pdfFile.getUrl(),
    folderUrl: monthF.getUrl(),
    pdfBlob: pdfBlob,
    docFile: docFile,
    pdfFile: pdfFile
  };
}

/**
 * 용역표에서 항목명이 빈 줄을 제거한다(패키지마다 5~6개로 달라서).
 * 헤더에 '용역'이 포함된 표를 대상으로, 항목명 셀(index 1)이 빈 행을 삭제.
 */
function trimEmptyServiceRows(body) {
  var tables = body.getTables();
  for (var t = 0; t < tables.length; t++) {
    var tbl = tables[t];
    if (tbl.getNumRows() < 2) continue;
    if (tbl.getRow(0).getText().indexOf('용역') === -1) continue; // 서비스 표만
    for (var r = tbl.getNumRows() - 1; r >= 1; r--) {
      var row = tbl.getRow(r);
      if (row.getNumCells() < 2) continue;
      if (row.getCell(1).getText().trim() === '') tbl.removeRow(r);
    }
  }
}

/** 하위 폴더 찾거나 없으면 생성 */
function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** {{}} 등 정규식 특수문자 이스케이프 (replaceText 는 정규식을 받음) */
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 고객에게 계약서 PDF 메일 발송 */
function emailContract(to, contractNo, customer, pkg, pdfBlob) {
  var subject = '[커넥트와이즈] 광고 대행 용역 계약서 (' + contractNo + ')';
  var body =
    (customer.company || '고객') + ' 담당자님, 안녕하세요.\n\n' +
    '주식회사 커넥트와이즈입니다. 협의된 ' + pkg.name + ' 패키지 기준 계약서를 첨부드립니다.\n' +
    '· 총 계약금액: ' + won(pkg.total) + ' (VAT 포함)\n\n' +
    '내용 확인 후 서명·날인하여 회신 부탁드립니다. 감사합니다.\n\n' +
    '주식회사 커넥트와이즈\n' + CONFIG.COMPANY.address + '\n' + CONFIG.COMPANY.phone;
  MailApp.sendEmail({
    to: to, subject: subject, body: body,
    attachments: [pdfBlob], name: '커넥트와이즈 영업팀'
  });
}
