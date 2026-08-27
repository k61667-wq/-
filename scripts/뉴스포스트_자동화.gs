/**
 * 당근 뉴스포스트 운영 자동화 — Google Apps Script
 * 스프레드시트: "뉴스포스트 운영 마스터"
 *
 * 이 스크립트가 담당하는 것
 *  1) company_id / post_id / concept_id 자동 채번
 *  2) 발행URL 입력 시 상태·발행일·콘셉트사용·계정사용일 자동 전파
 *  3) 최종_게시본문(상단+본문+하단) 자동 결합
 *  4) 1차 기계검수 (금지어·필수기재·반복·확인필요 토큰)
 *  5) ⛔ 차단 상태에서 '승인'으로 상태 변경 차단
 *  6) Claude API 호출 — 콘셉트 풀 생성 / 초안 생성 / 2차 검수
 *  7) 매일 알림 — 초대 리마인드·발행 공백·정체·잔여 콘셉트 부족
 *  8) 중간보고 초안 자동 생성
 *
 * 설치 방법은 파일 맨 아래 주석 참고.
 */

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────

/** 탭 이름 */
var SHEETS = {
  MASTER:   '01_Company_Master',
  ACCOUNT:  '02_계정관리',
  INVITE:   '03_초대현황',
  CONCEPT:  '04_콘셉트DB',
  POST:     '05_뉴스포스트_작성',
  DASH:     '06_대시보드',
  REPORT:   '07_보고로그'
};

/** 01_Company_Master 열 번호 (1-base) */
var M = {
  ID:1, NAME:2, INDUSTRY:3, SI:4, DONG:5, URL:6, AE:7, CLIENT:8, CONTACT:9,
  SERVICE:10, DIFF:11, KW_MAIN:12, KW_LONG:13, KW_BAN:14, TONE:15,
  ECOM:16, BIZNO:17, CEO:18, HEAD:19, FOOT:20, CTA:21,
  GOAL:22, START:23, END:24, STATUS:25
};

/** 05_뉴스포스트_작성 열 번호 (1-base) */
var P = {
  ID:1, NAME:2, CID:3, INDUSTRY:4, REGION:5, URL:6, ACCOUNT:7,
  KW_MAIN:8, KW_LONG:9, KW_BAN:10, TONE:11, HEAD:12, FOOT:13, RECENT:14,
  CONCEPT:15, CATEGORY:16, CONCEPT_LINE:17,
  TITLES:18, TITLE:19, DRAFT:20, BODY:21, PHOTO:22,
  CHECK:23, AI_CHECK:24, FINAL:25,
  REVIEWER:26, REVIEW_DATE:27, REVIEW_MEMO:28,
  STATUS:29, PUB_URL:30, PUB_DATE:31, VIEWS:32, CREATED:33, UPDATED:34
};

/** 04_콘셉트DB 열 번호 */
var C = { ID:1, CID:2, CATEGORY:3, SUBTYPE:4, LINE:5, KEYWORD:6, PAIN:7, DIFF:8, PRIORITY:9, USED:10, POST:11, USED_DATE:12, STATUS:13 };

/** 02_계정관리 열 번호 */
var A = { ID:1, EMAIL:2, PURPOSE:3, CID:4, NAME:5, STATUS:6, TFA:7, VAULT:8, LAST_USED:9, DUP:10, IDLE:11 };

/** 03_초대현황 열 번호 */
var I = { ID:1, CID:2, NAME:3, TARGET:4, METHOD:5, SENT:6, STATUS:7, ACCEPTED:8, RECOUNT:9, RESENT:10, DAYS:11, ALERT:12, RISK:13, OWNER:14 };

/** 법적 금지 표현 사전 — 근거 자료 없이 쓰면 표시·광고법 위반 소지 */
var BANNED_PHRASES = [
  '최고', '1위', '일등', '국내 유일', '유일한', '업계 최초', '국내 최초',
  '완치', '100%', '100퍼센트', '부작용 없', '즉시 해결', '무조건',
  '정부 인증', '특허받은', '협회 공인', '보장합니다', '반드시 성공'
];

/** 노출 공백 경보 기준 (일) — 당근 소식은 최근 1주일 내 글만 노출 후보군에 든다 */
var GAP_ALERT_DAYS = 7;

/** 초대 리마인드 기준 (일) */
var INVITE_ALERT_DAYS = 3;

/** 잔여 콘셉트 부족 기준 (개) */
var CONCEPT_LOW = 5;

/** Claude API */
var CLAUDE_MODEL = 'claude-opus-5';
var CLAUDE_URL   = 'https://api.anthropic.com/v1/messages';
var CLAUDE_VER   = '2023-06-01';


// ─────────────────────────────────────────────
// 메뉴
// ─────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🥕 뉴스포스트')
    .addItem('① 콘셉트 풀 생성 (선택 업체)', 'generateConceptPool')
    .addItem('② 초안 생성 (선택 행)', 'generateDraft')
    .addItem('③ AI 2차 검수 (선택 행)', 'runAiReview')
    .addSeparator()
    .addItem('기계검수 다시 실행 (선택 행)', 'recheckSelectedRow')
    .addItem('최종 게시본문 다시 결합 (선택 행)', 'rebuildFinalBody')
    .addSeparator()
    .addItem('중간보고 초안 생성 (선택 업체)', 'generateInterimReport')
    .addItem('오늘의 알림 지금 보내기', 'sendDailyAlerts')
    .addToUi();
}


// ─────────────────────────────────────────────
// 1) 편집 트리거 — 자동 채번 · 자동 전파 · 검수 · 승인 차단
// ─────────────────────────────────────────────

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  var name = sh.getName();
  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row === 1) return;

  try {
    if (name === SHEETS.MASTER)  handleMasterEdit_(sh, row, col);
    if (name === SHEETS.POST)    handlePostEdit_(sh, row, col, e);
    if (name === SHEETS.CONCEPT) autoId_(sh, row, C.ID, 'CP-', 4);
    if (name === SHEETS.ACCOUNT) autoId_(sh, row, A.ID, 'AC-', 3);
    if (name === SHEETS.INVITE)  autoId_(sh, row, I.ID, 'IV-', 3);
  } catch (err) {
    // onEdit 안에서 예외가 나면 사용자에게 조용히 실패하므로 셀에 흔적을 남긴다
    Logger.log('onEdit error: ' + err);
  }
}

/** Master: 업체명 입력 시 company_id 자동 채번 */
function handleMasterEdit_(sh, row, col) {
  if (col !== M.NAME) return;
  autoId_(sh, row, M.ID, 'CM-', 3);
}

/**
 * 작성 시트 편집 처리
 *  - 업체명 선택 → company_id 변환 + 업체정보 전량 호출
 *  - 콘셉트 선택 → 카테고리·콘셉트 한줄 호출
 *  - 본문 확정 → 최종본문 결합 + 기계검수
 *  - 상태 '승인' → 차단 항목 있으면 되돌림
 *  - 발행URL 입력 → 상태·발행일·콘셉트사용·계정사용일 전파
 */
function handlePostEdit_(sh, row, col, e) {
  if (col === P.NAME) {
    autoId_(sh, row, P.ID, 'NP-', 4);
    fillCompanyInfo_(sh, row);
    sh.getRange(row, P.CREATED).setValue(sh.getRange(row, P.CREATED).getValue() || new Date());
  }

  if (col === P.CONCEPT) fillConceptInfo_(sh, row);

  if (col === P.HEAD || col === P.BODY || col === P.FOOT) {
    rebuildFinal_(sh, row);
    runMachineCheck_(sh, row);
  }

  if (col === P.STATUS) {
    var status = String(e.value || '');
    if (status === '승인') {
      runMachineCheck_(sh, row);
      var result = String(sh.getRange(row, P.CHECK).getValue() || '');
      if (result.indexOf('⛔') === 0) {
        sh.getRange(row, P.STATUS).setValue('수정요청');
        SpreadsheetApp.getActive().toast(
          '기계검수 차단 항목이 있어 승인할 수 없습니다.\n' + result, '승인 차단', 10);
      }
    }
  }

  if (col === P.PUB_URL) {
    var url = String(e.value || '').trim();
    if (url) propagatePublish_(sh, row, url);
  }

  sh.getRange(row, P.UPDATED).setValue(new Date());
}


// ─────────────────────────────────────────────
// 2) 자동 채번
// ─────────────────────────────────────────────

/** 해당 열이 비어 있으면 PREFIX + 다음 일련번호를 넣는다 */
function autoId_(sh, row, col, prefix, pad) {
  if (sh.getRange(row, col).getValue()) return;
  var last = sh.getLastRow();
  var max = 0;
  if (last >= 2) {
    var vals = sh.getRange(2, col, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i][0] || '');
      if (v.indexOf(prefix) === 0) {
        var n = parseInt(v.substring(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
  }
  var next = String(max + 1);
  while (next.length < pad) next = '0' + next;
  sh.getRange(row, col).setValue(prefix + next);
}


// ─────────────────────────────────────────────
// 3) 업체 정보 자동 호출 (재입력 제거의 핵심)
// ─────────────────────────────────────────────

/** Master를 company_id로 조회해 객체로 반환 */
function getCompany_(cid) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.MASTER);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, M.STATUS).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][M.ID - 1]) === String(cid)) {
      var r = vals[i];
      return {
        id: r[M.ID-1], name: r[M.NAME-1], industry: r[M.INDUSTRY-1],
        si: r[M.SI-1], dong: r[M.DONG-1], url: r[M.URL-1],
        service: r[M.SERVICE-1], diff: r[M.DIFF-1],
        kwMain: r[M.KW_MAIN-1], kwLong: r[M.KW_LONG-1], kwBan: r[M.KW_BAN-1],
        tone: r[M.TONE-1], ecom: String(r[M.ECOM-1]).toUpperCase() === 'Y',
        bizNo: r[M.BIZNO-1], ceo: r[M.CEO-1],
        head: r[M.HEAD-1], foot: r[M.FOOT-1], cta: r[M.CTA-1],
        goal: r[M.GOAL-1], start: r[M.START-1], end: r[M.END-1], status: r[M.STATUS-1]
      };
    }
  }
  return null;
}

/** 업체명 → company_id 변환 */
function nameToId_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.MASTER);
  var last = sh.getLastRow();
  if (last < 2) return '';
  var vals = sh.getRange(2, 1, last - 1, M.NAME).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][M.NAME - 1]) === String(name)) return vals[i][M.ID - 1];
  }
  return '';
}

/** 업체 선택 시 13개 열을 한 번에 채운다 — 담당자는 아무것도 입력하지 않는다 */
function fillCompanyInfo_(sh, row) {
  var name = sh.getRange(row, P.NAME).getValue();
  if (!name) return;
  var cid = nameToId_(name);
  sh.getRange(row, P.CID).setValue(cid);
  var c = getCompany_(cid);
  if (!c) return;

  sh.getRange(row, P.INDUSTRY).setValue(c.industry);
  sh.getRange(row, P.REGION).setValue(String(c.si || '') + ' ' + String(c.dong || ''));
  sh.getRange(row, P.URL).setValue(c.url);
  sh.getRange(row, P.ACCOUNT).setValue(getAccountFor_(cid));
  sh.getRange(row, P.KW_MAIN).setValue(c.kwMain);
  sh.getRange(row, P.KW_LONG).setValue(c.kwLong);
  sh.getRange(row, P.KW_BAN).setValue(c.kwBan);
  sh.getRange(row, P.TONE).setValue(c.tone);
  sh.getRange(row, P.HEAD).setValue(c.head);
  sh.getRange(row, P.FOOT).setValue(c.foot);
  sh.getRange(row, P.RECENT).setValue(getRecentTitles_(cid, 3));
}

/** 배정된 Google 계정 조회 */
function getAccountFor_(cid) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.ACCOUNT);
  var last = sh.getLastRow();
  if (last < 2) return '';
  var vals = sh.getRange(2, 1, last - 1, A.STATUS).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][A.CID - 1]) === String(cid)) {
      var st = String(vals[i][A.STATUS - 1]);
      var email = vals[i][A.EMAIL - 1];
      return st === '잠김' ? ('⚠ 잠김: ' + email) : email;
    }
  }
  return '⚠ 미배정';
}

/** 같은 업체의 최근 발행 제목 n건 — 주제 중복 회피용 */
function getRecentTitles_(cid, n) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.POST);
  var last = sh.getLastRow();
  if (last < 2) return '';
  var vals = sh.getRange(2, 1, last - 1, P.PUB_DATE).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][P.CID - 1]) === String(cid) && vals[i][P.PUB_DATE - 1]) {
      rows.push({ t: vals[i][P.TITLE - 1], d: new Date(vals[i][P.PUB_DATE - 1]).getTime() });
    }
  }
  rows.sort(function(a, b) { return b.d - a.d; });
  return rows.slice(0, n).map(function(r) { return '- ' + r.t; }).join('\n');
}

/** 콘셉트 선택 시 카테고리·한줄 호출 */
function fillConceptInfo_(sh, row) {
  var conceptId = sh.getRange(row, P.CONCEPT).getValue();
  if (!conceptId) return;
  var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
  var last = cs.getLastRow();
  if (last < 2) return;
  var vals = cs.getRange(2, 1, last - 1, C.STATUS).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][C.ID - 1]) === String(conceptId)) {
      sh.getRange(row, P.CATEGORY).setValue(vals[i][C.CATEGORY - 1]);
      sh.getRange(row, P.CONCEPT_LINE).setValue(vals[i][C.LINE - 1]);
      return;
    }
  }
}


// ─────────────────────────────────────────────
// 4) 최종 게시본문 결합 (상단 + 본문 + 하단)
// ─────────────────────────────────────────────

function rebuildFinal_(sh, row) {
  var head = String(sh.getRange(row, P.HEAD).getValue() || '').trim();
  var body = String(sh.getRange(row, P.BODY).getValue() || '').trim();
  var foot = String(sh.getRange(row, P.FOOT).getValue() || '').trim();
  if (!body) { sh.getRange(row, P.FINAL).setValue(''); return; }
  var parts = [];
  if (head) parts.push(head);
  parts.push(body);
  if (foot) parts.push(foot);
  sh.getRange(row, P.FINAL).setValue(parts.join('\n\n'));
}

function rebuildFinalBody() {
  var sh = SpreadsheetApp.getActiveSheet();
  var row = sh.getActiveRange().getRow();
  rebuildFinal_(sh, row);
  runMachineCheck_(sh, row);
  SpreadsheetApp.getActive().toast('최종 게시본문을 다시 결합했습니다.', '완료', 5);
}


// ─────────────────────────────────────────────
// 5) 1차 기계검수
// ─────────────────────────────────────────────

function recheckSelectedRow() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEETS.POST) { alert_('05_뉴스포스트_작성 시트에서 실행하세요.'); return; }
  runMachineCheck_(sh, sh.getActiveRange().getRow());
}

/**
 * 정규식·문자열로 잡을 수 있는 것을 전부 잡는다.
 * ⛔ 차단이 하나라도 있으면 '승인' 상태로 넘어갈 수 없다.
 */
function runMachineCheck_(sh, row) {
  var cid = sh.getRange(row, P.CID).getValue();
  var c = getCompany_(cid);
  var final = String(sh.getRange(row, P.FINAL).getValue() || '');
  var body  = String(sh.getRange(row, P.BODY).getValue() || '');
  var foot  = String(sh.getRange(row, P.FOOT).getValue() || '');

  if (!final) { sh.getRange(row, P.CHECK).setValue(''); return; }

  var block = [];
  var warn = [];

  // 확인필요 토큰 잔존 — AI가 사실을 모른다고 표시한 자리
  if (final.indexOf('[확인필요') >= 0) block.push('확인필요 토큰 미해결');

  if (c) {
    // 상단: 업체명
    if (final.indexOf(String(c.name)) < 0) block.push('업체명 미포함');

    // 상단: 메인 키워드 1개 이상
    var mains = splitList_(c.kwMain);
    var hasMain = mains.some(function(k) { return k && final.indexOf(k) >= 0; });
    if (mains.length && !hasMain) warn.push('메인 키워드 미포함(동네지도 검색 노출 손실)');

    // 하단: 연락처
    if (!/\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(foot)) block.push('하단 연락처 누락');

    // 통신판매업 대상이면 사업자등록번호 표시 의무
    if (c.ecom && !/\d{3}-\d{2}-\d{5}/.test(final)) {
      block.push('통신판매업 대상 — 사업자등록번호 누락');
    }
    if (c.ecom && String(c.ceo || '') && final.indexOf(String(c.ceo)) < 0) {
      block.push('통신판매업 대상 — 대표자명 누락');
    }

    // 업체별 금지 키워드
    splitList_(c.kwBan).forEach(function(k) {
      if (k && final.indexOf(k) >= 0) block.push('업체 금지키워드("' + k + '")');
    });

    // 키워드 과다 반복
    mains.concat(splitList_(c.kwLong)).forEach(function(k) {
      if (k && countOccurrences_(final, k) >= 4) warn.push('키워드 과다반복("' + k + '")');
    });
  }

  // 법적 금지 표현
  BANNED_PHRASES.forEach(function(p) {
    if (final.indexOf(p) >= 0) block.push('금지표현("' + p + '")');
  });

  // 플랫폼 관행
  var phoneCount = (body.match(/\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || []).length;
  if (phoneCount >= 3) warn.push('본문 연락처 반복(' + phoneCount + '회)');
  if (/★{3,}|!{3,}|~{3,}|\?{3,}/.test(final)) warn.push('특수문자 도배');
  if (body.replace(/\s/g, '').length < 300) warn.push('본문이 짧음(300자 미만)');

  var msg;
  if (block.length) msg = '⛔ 차단: ' + dedupe_(block).join(', ');
  else if (warn.length) msg = '⚠ 경고: ' + dedupe_(warn).join(', ');
  else msg = '✅ 통과';

  sh.getRange(row, P.CHECK).setValue(msg);
}

function splitList_(v) {
  return String(v || '').split(/[\n|,]/).map(function(s) { return s.trim(); }).filter(String);
}

function countOccurrences_(text, needle) {
  if (!needle) return 0;
  var n = 0, idx = 0;
  while ((idx = text.indexOf(needle, idx)) >= 0) { n++; idx += needle.length; }
  return n;
}

function dedupe_(arr) {
  var seen = {}, out = [];
  arr.forEach(function(v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
  return out;
}


// ─────────────────────────────────────────────
// 6) 발행 URL 1회 입력 → 전파
// ─────────────────────────────────────────────

/** 사람이 값을 옮겨 적는 마지막 지점. 여기서 나머지가 전부 자동으로 따라간다. */
function propagatePublish_(sh, row, url) {
  var today = new Date();
  sh.getRange(row, P.STATUS).setValue('등록완료');
  if (!sh.getRange(row, P.PUB_DATE).getValue()) sh.getRange(row, P.PUB_DATE).setValue(today);

  // 콘셉트 사용 처리 (사용여부 열은 수식이므로 여기서는 post_id·사용일만 기록)
  var conceptId = sh.getRange(row, P.CONCEPT).getValue();
  if (conceptId) {
    var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
    var last = cs.getLastRow();
    if (last >= 2) {
      var ids = cs.getRange(2, C.ID, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(conceptId)) {
          cs.getRange(i + 2, C.POST).setValue(sh.getRange(row, P.ID).getValue());
          cs.getRange(i + 2, C.USED_DATE).setValue(today);
          break;
        }
      }
    }
  }

  // 계정 최근 사용일 갱신
  var cid = sh.getRange(row, P.CID).getValue();
  var as = SpreadsheetApp.getActive().getSheetByName(SHEETS.ACCOUNT);
  var alast = as.getLastRow();
  if (alast >= 2) {
    var acids = as.getRange(2, A.CID, alast - 1, 1).getValues();
    for (var j = 0; j < acids.length; j++) {
      if (String(acids[j][0]) === String(cid)) { as.getRange(j + 2, A.LAST_USED).setValue(today); break; }
    }
  }
}


// ─────────────────────────────────────────────
// 7) Claude API
// ─────────────────────────────────────────────

/**
 * API 키는 스크립트 속성에 저장한다 (코드·시트에 하드코딩 금지).
 * 프로젝트 설정 → 스크립트 속성 → ANTHROPIC_API_KEY
 */
function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('스크립트 속성에 ANTHROPIC_API_KEY가 없습니다. 프로젝트 설정에서 등록하세요.');
  return key;
}

/**
 * Messages API 호출. 응답의 text 블록을 이어붙여 반환한다.
 * thinking은 adaptive (budget_tokens는 현재 모델에서 거부됨).
 */
function callClaude_(system, user, maxTokens, effort) {
  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens || 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: effort || 'medium' },
    system: system,
    messages: [{ role: 'user', content: user }]
  };

  var res = UrlFetchApp.fetch(CLAUDE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': getApiKey_(), 'anthropic-version': CLAUDE_VER },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API 오류 ' + code + ': ' + res.getContentText().slice(0, 500));

  var json = JSON.parse(res.getContentText());

  // 안전 분류기가 요청을 거절한 경우 content가 비어 있을 수 있다
  if (json.stop_reason === 'refusal') throw new Error('요청이 거절되었습니다. 입력 내용을 확인하세요.');

  var out = '';
  (json.content || []).forEach(function(b) { if (b.type === 'text') out += b.text; });
  return out;
}

/** 모델이 코드펜스를 붙였을 경우까지 감안해 JSON을 추출한다 */
function parseJson_(text) {
  var t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  var s = t.indexOf('{'), sa = t.indexOf('[');
  var start = (sa >= 0 && (s < 0 || sa < s)) ? sa : s;
  var end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start < 0 || end < 0) throw new Error('JSON 파싱 실패: ' + t.slice(0, 200));
  return JSON.parse(t.substring(start, end + 1));
}


// ─────────────────────────────────────────────
// 8) ① 콘셉트 풀 생성
// ─────────────────────────────────────────────

function generateConceptPool() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEETS.MASTER) { alert_('01_Company_Master 시트에서 업체 행을 선택한 뒤 실행하세요.'); return; }
  var row = sh.getActiveRange().getRow();
  var cid = sh.getRange(row, M.ID).getValue();
  var c = getCompany_(cid);
  if (!c) { alert_('업체를 찾을 수 없습니다.'); return; }

  var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
  var existing = getExistingConcepts_(cid);

  var system = PROMPT_CONCEPT_SYSTEM;
  var user = [
    '업체명: ' + c.name,
    '업종: ' + c.industry,
    '지역: ' + c.si + ' ' + c.dong,
    '주요 서비스: ' + c.service,
    '업체 차별점: ' + c.diff,
    '메인 키워드: ' + c.kwMain,
    '롱테일 키워드: ' + c.kwLong,
    '금지 키워드: ' + c.kwBan,
    '톤앤매너: ' + c.tone,
    '계약 기간: ' + fmtDate_(c.start) + ' ~ ' + fmtDate_(c.end),
    '목표 발행 수: ' + c.goal,
    '',
    '[이미 사용한 콘셉트 — 중복 금지]',
    existing || '(없음)',
    '',
    '20개를 설계하십시오. JSON 배열만 출력하십시오.'
  ].join('\n');

  SpreadsheetApp.getActive().toast('콘셉트 20개를 생성하는 중입니다...', '진행 중', 30);
  var list = parseJson_(callClaude_(system, user, 16000, 'high'));

  var startRow = cs.getLastRow() + 1;
  var rows = list.map(function(it) {
    return ['', cid, it.category, it.subtype, it.concept, it.keyword, it.pain, it.diff_link, it.priority, '', '', '', '활성'];
  });
  cs.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  for (var i = 0; i < rows.length; i++) autoId_(cs, startRow + i, C.ID, 'CP-', 4);

  alert_(rows.length + '개의 콘셉트를 04_콘셉트DB에 추가했습니다.');
}

function getExistingConcepts_(cid) {
  var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
  var last = cs.getLastRow();
  if (last < 2) return '';
  var vals = cs.getRange(2, 1, last - 1, C.LINE).getValues();
  return vals.filter(function(r) { return String(r[C.CID - 1]) === String(cid); })
             .map(function(r) { return '- ' + r[C.LINE - 1]; }).join('\n');
}


// ─────────────────────────────────────────────
// 9) ② 초안 생성
// ─────────────────────────────────────────────

function generateDraft() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEETS.POST) { alert_('05_뉴스포스트_작성 시트에서 실행하세요.'); return; }
  var row = sh.getActiveRange().getRow();

  var cid = sh.getRange(row, P.CID).getValue();
  var c = getCompany_(cid);
  if (!c) { alert_('업체명을 먼저 선택하세요.'); return; }
  if (!sh.getRange(row, P.CONCEPT).getValue()) { alert_('콘셉트(concept_id)를 먼저 선택하세요.'); return; }

  var concept = getConcept_(sh.getRange(row, P.CONCEPT).getValue());

  var user = [
    '[업체 정보]',
    '업체명: ' + c.name,
    '업종: ' + c.industry,
    '지역: ' + c.si + ' ' + c.dong,
    '주요 서비스: ' + c.service,
    '업체 차별점: ' + c.diff,
    '기본 CTA: ' + c.cta,
    '톤앤매너: ' + c.tone,
    '',
    '[키워드]',
    '메인 키워드: ' + c.kwMain,
    '롱테일 키워드: ' + c.kwLong,
    '금지 키워드: ' + c.kwBan,
    '',
    '[이번 회차 콘셉트]',
    '콘텐츠 카테고리: ' + concept.category,
    '세부 유형: ' + concept.subtype,
    '콘셉트 한줄: ' + concept.line,
    '겨냥하는 고객 고민: ' + concept.pain,
    '연결할 차별점: ' + concept.diff,
    '',
    '[중복 회피 — 최근 발행한 주제 3건]',
    String(sh.getRange(row, P.RECENT).getValue() || '(없음)'),
    '',
    '[참고: 본문에 다시 쓰지 말 것 — 시스템이 자동으로 붙임]',
    '필수기재 상단: ' + c.head,
    '필수기재 하단: ' + c.foot,
    '',
    '위 정보만으로 소식글 초안을 작성하십시오. JSON만 출력하십시오.'
  ].join('\n');

  SpreadsheetApp.getActive().toast('초안을 생성하는 중입니다...', '진행 중', 30);
  var r = parseJson_(callClaude_(PROMPT_DRAFT_SYSTEM, user, 8000, 'medium'));

  sh.getRange(row, P.TITLES).setValue((r.titles || []).map(function(t, i) { return (i + 1) + '. ' + t; }).join('\n'));
  sh.getRange(row, P.DRAFT).setValue(r.body || '');
  if (!sh.getRange(row, P.BODY).getValue()) sh.getRange(row, P.BODY).setValue(r.body || '');
  sh.getRange(row, P.PHOTO).setValue(r.photo_guide || '');
  if (!sh.getRange(row, P.TITLE).getValue() && r.titles && r.titles.length) {
    sh.getRange(row, P.TITLE).setValue(r.titles[0]);
  }
  sh.getRange(row, P.STATUS).setValue('검수대기');

  rebuildFinal_(sh, row);
  runMachineCheck_(sh, row);

  var unverified = (r.self_check && r.self_check.unverified_tokens) || [];
  if (unverified.length) {
    SpreadsheetApp.getActive().toast('확인 필요 항목 ' + unverified.length + '건: ' + unverified.join(', '), '사실 확인 필요', 15);
  }
}

function getConcept_(conceptId) {
  var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
  var last = cs.getLastRow();
  var empty = { category: '', subtype: '', line: '', pain: '', diff: '' };
  if (last < 2) return empty;
  var vals = cs.getRange(2, 1, last - 1, C.STATUS).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][C.ID - 1]) === String(conceptId)) {
      return {
        category: vals[i][C.CATEGORY-1], subtype: vals[i][C.SUBTYPE-1], line: vals[i][C.LINE-1],
        pain: vals[i][C.PAIN-1], diff: vals[i][C.DIFF-1]
      };
    }
  }
  return empty;
}


// ─────────────────────────────────────────────
// 10) ③ AI 2차 검수
// ─────────────────────────────────────────────

function runAiReview() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEETS.POST) { alert_('05_뉴스포스트_작성 시트에서 실행하세요.'); return; }
  var row = sh.getActiveRange().getRow();
  var c = getCompany_(sh.getRange(row, P.CID).getValue());
  var final = String(sh.getRange(row, P.FINAL).getValue() || '');
  if (!final) { alert_('최종 게시본문이 비어 있습니다.'); return; }

  var user = [
    '[업체 정보 — 이 범위 밖의 사실이 본문에 있으면 창작된 것입니다]',
    '업체명: ' + c.name,
    '업종: ' + c.industry,
    '지역: ' + c.si + ' ' + c.dong,
    '주요 서비스: ' + c.service,
    '업체 차별점: ' + c.diff,
    '통신판매업 신고 대상: ' + (c.ecom ? 'Y' : 'N'),
    '금지 키워드: ' + c.kwBan,
    '메인 키워드: ' + c.kwMain,
    '',
    '[검수 대상 — 최종 게시본문]',
    final,
    '',
    '검수하십시오. JSON만 출력하십시오.'
  ].join('\n');

  SpreadsheetApp.getActive().toast('AI 검수 중입니다...', '진행 중', 30);
  var r = parseJson_(callClaude_(PROMPT_REVIEW_SYSTEM, user, 4000, 'medium'));

  var lines = ['[' + r.verdict + '] ' + (r.summary || '')];
  (r.legal_issues || []).forEach(function(x) { lines.push('• ' + x.severity + ' "' + x.text + '" — ' + x.why + ' → ' + x.fix); });
  if (r.industry_regulation) lines.push('• 업종규제: ' + r.industry_regulation);
  (r.facts_to_verify || []).forEach(function(x) { lines.push('• 사실확인: ' + x); });
  (r.platform_warnings || []).forEach(function(x) { lines.push('• 관행: ' + x); });
  (r.exposure_notes || []).forEach(function(x) { lines.push('• 노출: ' + x); });

  sh.getRange(row, P.AI_CHECK).setValue(lines.join('\n'));
  if (r.verdict === 'BLOCK') sh.getRange(row, P.STATUS).setValue('수정요청');
}


// ─────────────────────────────────────────────
// 11) 매일 알림 (시간 트리거)
// ─────────────────────────────────────────────

/**
 * 매일 09:30 실행 권장. 사람이 기억으로 챙기던 것을 전부 대신한다.
 *  - 초대 수락 지연
 *  - 발행 공백 7일 초과 (노출 후보군 이탈)
 *  - 검수 정체 3일 초과
 *  - 잔여 콘셉트 5개 미만
 *  - 계정 중복배정·잠김
 */
function sendDailyAlerts() {
  var ss = SpreadsheetApp.getActive();
  var today = new Date();
  var msgs = [];

  // 초대 지연
  var isv = ss.getSheetByName(SHEETS.INVITE);
  if (isv.getLastRow() >= 2) {
    isv.getRange(2, 1, isv.getLastRow() - 1, I.OWNER).getValues().forEach(function(r) {
      if (String(r[I.STATUS - 1]) === '수락대기' && r[I.SENT - 1]) {
        var d = daysBetween_(r[I.SENT - 1], today);
        if (d >= INVITE_ALERT_DAYS) {
          msgs.push('[초대] ' + r[I.NAME - 1] + ' — 수락대기 ' + d + '일차' + (d > 7 ? ' 🔴 재초대 필요' : ''));
        }
      }
    });
  }

  // 업체별 발행 공백 · 잔여 콘셉트
  var ms = ss.getSheetByName(SHEETS.MASTER);
  if (ms.getLastRow() >= 2) {
    ms.getRange(2, 1, ms.getLastRow() - 1, M.STATUS).getValues().forEach(function(r) {
      if (String(r[M.STATUS - 1]) !== '진행중') return;
      var cid = r[M.ID - 1], nm = r[M.NAME - 1];

      var lastPub = getLastPublishDate_(cid);
      if (lastPub) {
        var gap = daysBetween_(lastPub, today);
        if (gap > GAP_ALERT_DAYS) {
          msgs.push('[공백] ' + nm + ' — 마지막 발행 ' + gap + '일 전 🔴 노출 후보군 이탈');
        }
      } else {
        msgs.push('[공백] ' + nm + ' — 발행 이력 없음 🔴');
      }

      var remain = countRemainingConcepts_(cid);
      if (remain < CONCEPT_LOW) msgs.push('[소재] ' + nm + ' — 잔여 콘셉트 ' + remain + '개 🟡 보충 필요');
    });
  }

  // 검수 정체
  var ps = ss.getSheetByName(SHEETS.POST);
  if (ps.getLastRow() >= 2) {
    ps.getRange(2, 1, ps.getLastRow() - 1, P.UPDATED).getValues().forEach(function(r) {
      var st = String(r[P.STATUS - 1]);
      if (st && st !== '등록완료' && r[P.UPDATED - 1]) {
        var d = daysBetween_(r[P.UPDATED - 1], today);
        if (d >= 3) msgs.push('[정체] ' + r[P.ID - 1] + ' ' + r[P.NAME - 1] + ' — ' + st + ' 상태 ' + d + '일');
      }
    });
  }

  // 계정 이상
  var as = ss.getSheetByName(SHEETS.ACCOUNT);
  if (as.getLastRow() >= 2) {
    var accs = as.getRange(2, 1, as.getLastRow() - 1, A.STATUS).getValues();
    var seen = {};
    accs.forEach(function(r) {
      var cid = String(r[A.CID - 1] || '');
      if (cid) { if (seen[cid]) msgs.push('[계정] company_id ' + cid + ' 중복 배정 ⚠'); seen[cid] = 1; }
      if (String(r[A.STATUS - 1]) === '잠김') msgs.push('[계정] ' + r[A.EMAIL - 1] + ' 잠김 상태 ⚠');
    });
  }

  if (!msgs.length) return; // 조용한 날은 메일을 보내지 않는다

  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: '[뉴스포스트] 오늘 확인할 것 ' + msgs.length + '건',
    body: msgs.join('\n') + '\n\n대시보드: ' + SpreadsheetApp.getActive().getUrl()
  });
}

function getLastPublishDate_(cid) {
  var ps = SpreadsheetApp.getActive().getSheetByName(SHEETS.POST);
  if (ps.getLastRow() < 2) return null;
  var vals = ps.getRange(2, 1, ps.getLastRow() - 1, P.PUB_DATE).getValues();
  var max = null;
  vals.forEach(function(r) {
    if (String(r[P.CID - 1]) === String(cid) && r[P.PUB_DATE - 1]) {
      var d = new Date(r[P.PUB_DATE - 1]);
      if (!max || d > max) max = d;
    }
  });
  return max;
}

function countRemainingConcepts_(cid) {
  var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
  if (cs.getLastRow() < 2) return 0;
  var vals = cs.getRange(2, 1, cs.getLastRow() - 1, C.STATUS).getValues();
  var n = 0;
  vals.forEach(function(r) {
    if (String(r[C.CID - 1]) === String(cid) && String(r[C.USED - 1]) !== '사용됨' && String(r[C.STATUS - 1]) === '활성') n++;
  });
  return n;
}

function daysBetween_(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}


// ─────────────────────────────────────────────
// 12) 중간보고 초안 생성
// ─────────────────────────────────────────────

/**
 * 사람은 성과 해석·제안만 추가합니다. 집계와 목록 정리는 전부 여기서 끝납니다.
 */
function generateInterimReport() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEETS.MASTER) { alert_('01_Company_Master에서 업체 행을 선택한 뒤 실행하세요.'); return; }
  var row = sh.getActiveRange().getRow();
  var c = getCompany_(sh.getRange(row, M.ID).getValue());
  if (!c) { alert_('업체를 찾을 수 없습니다.'); return; }

  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('보고 기간', '시작일과 종료일을 입력하세요 (예: 2026-08-01 ~ 2026-08-31)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var parts = res.getResponseText().split('~').map(function(s) { return s.trim(); });
  var from = new Date(parts[0]), to = new Date(parts[1]);

  var ps = SpreadsheetApp.getActive().getSheetByName(SHEETS.POST);
  var posts = [];
  if (ps.getLastRow() >= 2) {
    ps.getRange(2, 1, ps.getLastRow() - 1, P.PUB_DATE).getValues().forEach(function(r) {
      if (String(r[P.CID - 1]) !== String(c.id)) return;
      if (!r[P.PUB_DATE - 1]) return;
      var d = new Date(r[P.PUB_DATE - 1]);
      if (d >= from && d <= to) {
        posts.push({ title: r[P.TITLE - 1], category: r[P.CATEGORY - 1], date: d, url: r[P.PUB_URL - 1] });
      }
    });
  }
  posts.sort(function(a, b) { return a.date - b.date; });

  var totalDone = countPublished_(c.id);
  var byCat = {};
  posts.forEach(function(p) { byCat[p.category] = (byCat[p.category] || 0) + 1; });

  var doc = DocumentApp.create('[중간보고] ' + c.name + ' ' + fmtDate_(from) + '~' + fmtDate_(to));
  var b = doc.getBody();

  b.appendParagraph(c.name + ' 뉴스포스트 운영 중간보고').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  b.appendParagraph('보고 기간: ' + fmtDate_(from) + ' ~ ' + fmtDate_(to));
  b.appendParagraph('');

  b.appendParagraph('1. 진행 현황').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  b.appendParagraph('· 이번 기간 발행: ' + posts.length + '건');
  b.appendParagraph('· 누적 발행: ' + totalDone + ' / 목표 ' + c.goal + '건 (' + Math.round(totalDone / (c.goal || 1) * 100) + '%)');
  b.appendParagraph('· 계약 기간: ' + fmtDate_(c.start) + ' ~ ' + fmtDate_(c.end));
  b.appendParagraph('');

  b.appendParagraph('2. 발행 목록').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var t = b.appendTable([['발행일', '제목', '유형', 'URL']]);
  posts.forEach(function(p) { t.appendTableRow().appendTableCell(fmtDate_(p.date)).getParent().appendTableCell(String(p.title)).getParent().appendTableCell(String(p.category)).getParent().appendTableCell(String(p.url)); });
  b.appendParagraph('');

  b.appendParagraph('3. 다룬 소재 분포').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  Object.keys(byCat).forEach(function(k) { b.appendParagraph('· ' + k + ': ' + byCat[k] + '건'); });
  b.appendParagraph('');

  b.appendParagraph('4. 사용 키워드').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  b.appendParagraph('· 메인: ' + String(c.kwMain).replace(/\n/g, ', '));
  b.appendParagraph('· 롱테일: ' + String(c.kwLong).replace(/\n/g, ', '));
  b.appendParagraph('');

  b.appendParagraph('5. 다음 기간 예정 콘셉트').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  getNextConcepts_(c.id, 3).forEach(function(x) { b.appendParagraph('· ' + x); });
  b.appendParagraph('');

  b.appendParagraph('6. 성과 해석 및 제안').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  b.appendParagraph('[담당자 작성] ').editAsText().setForegroundColor('#B00020');

  doc.saveAndClose();

  // 보고로그 기록
  var rs = SpreadsheetApp.getActive().getSheetByName(SHEETS.REPORT);
  rs.appendRow(['', c.id, c.name, from, to, posts.length, totalDone + '/' + c.goal, doc.getUrl(), '', '', '초안']);
  autoId_(rs, rs.getLastRow(), 1, 'RP-', 4);

  alert_('중간보고 초안을 생성했습니다.\n' + doc.getUrl() + '\n\n"6. 성과 해석 및 제안"만 작성하시면 됩니다.');
}

function countPublished_(cid) {
  var ps = SpreadsheetApp.getActive().getSheetByName(SHEETS.POST);
  if (ps.getLastRow() < 2) return 0;
  var vals = ps.getRange(2, 1, ps.getLastRow() - 1, P.STATUS).getValues();
  var n = 0;
  vals.forEach(function(r) { if (String(r[P.CID - 1]) === String(cid) && String(r[P.STATUS - 1]) === '등록완료') n++; });
  return n;
}

function getNextConcepts_(cid, n) {
  var cs = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONCEPT);
  if (cs.getLastRow() < 2) return [];
  var vals = cs.getRange(2, 1, cs.getLastRow() - 1, C.STATUS).getValues();
  return vals.filter(function(r) {
      return String(r[C.CID - 1]) === String(cid) && String(r[C.USED - 1]) !== '사용됨' && String(r[C.STATUS - 1]) === '활성';
    })
    .sort(function(a, b) { return (a[C.PRIORITY - 1] || 9) - (b[C.PRIORITY - 1] || 9); })
    .slice(0, n)
    .map(function(r) { return r[C.LINE - 1] + ' (' + r[C.CATEGORY - 1] + ')'; });
}


// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────

function alert_(msg) { SpreadsheetApp.getUi().alert(msg); }

function fmtDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}


// ─────────────────────────────────────────────
// 프롬프트 (전문은 prompts/ 폴더 참고 — 여기 값이 실제 실행본)
// ─────────────────────────────────────────────

var PROMPT_CONCEPT_SYSTEM = [
'당신은 당근 비즈프로필 소식의 콘텐츠 기획자입니다. 한 업체에 대해 2~3개월치 소식 소재를 미리 설계합니다.',
'',
'# 소재 배분',
'당근에서 반응이 좋은 소재는 3가지뿐입니다. 노하우 공유 8 / 상품·서비스 소개 8 / 매장 일상 4로 배분하십시오.',
'신뢰가 중요한 업종(의료, 부동산, 요양, 법률, 컨설팅)은 노하우 10 / 상품 7 / 일상 3으로 조정하십시오.',
'',
'# 세부 유형',
'고객고민형, FAQ형, 체크리스트형, 사례형, 지역키워드형, 이벤트형, 서비스설명형, 가격패키지형',
'',
'# 설계 원칙',
'1. 20개가 서로 명확히 달라야 합니다. 표현만 바꾼 것은 1개로 칩니다.',
'2. 업체가 하고 싶은 말이 아니라 이웃이 알고 싶은 것에서 출발하십시오.',
'3. 제공된 롱테일 키워드를 최대한 소진하도록 배치하십시오.',
'4. 제공된 정보에 없는 사실(가격·경력·수상·인증·효능)을 만들지 마십시오.',
'5. 계절 소재는 계약 기간 내에 실제로 오는 시기만 쓰십시오.',
'6. 금지 키워드는 콘셉트명에도 쓰지 마십시오.',
'',
'# 우선순위',
'1 = 지금 써도 반응이 좋을 소재(초기 4~6개는 반드시 1), 2~3 = 중간, 4~5 = 예비',
'',
'# 출력',
'아래 JSON 배열만 출력하십시오. 설명·코드펜스 금지. 정확히 20개.',
'[{"category":"노하우 공유","subtype":"체크리스트형","concept":"한 줄 콘셉트","keyword":"키워드","pain":"고객 고민","diff_link":"연결할 차별점","priority":1}]'
].join('\n');

var PROMPT_DRAFT_SYSTEM = [
'당신은 당근(당근마켓) 비즈프로필 "소식"을 전문으로 쓰는 로컬 광고 카피라이터입니다.',
'',
'# 노출 방식',
'당근 소식은 홈피드, 동네지도 우리동네 업체소식, 동네지도 검색결과에 무료 노출됩니다.',
'노출 기준은 "최근 1주일 내 작성된 소식 중 이웃이 관심 가질 만한 것"입니다.',
'첫 1~2문장(훅)이 스크롤을 멈추게 하지 못하면 그 글은 없는 것과 같습니다.',
'',
'# 반응이 좋은 소재 3가지 — 하나만 명확히 따를 것 (섞지 말 것)',
'1. 상품·서비스 소개: 대표 하나에 집중 → 차별점 → 방문·문의 유도',
'2. 노하우 공유: 흔히 놓치는 것 2~3개를 번호로, 각 항목은 "무엇을 확인 + 왜 중요" 한두 문장',
'3. 매장 일상: 실제 장면/계절과 엮은 짧은 이야기, CTA는 부드럽게',
'',
'# 절대 규칙',
'1. 제공된 정보에 없는 사실을 만들지 마십시오. 가격·경력·수상·인증·자격·장비·고객수·효능을 추측하지 마십시오.',
'   필요한데 정보가 없으면 정확히 [확인필요: 무엇] 이라고 쓰십시오.',
'2. 근거 없이 다음 표현 금지 (표시·광고의 공정화에 관한 법률):',
'   최고, 1위, 국내 유일, 업계 최초, 완치, 100% 효과, 부작용 없음, 즉시 해결,',
'   실제 받지 않은 정부 인증·특허·협회 공인 암시, 조건 숨긴 "무료", 부풀린 할인율.',
'   의료·건강·미용 업종은 효과 단정 표현을 특히 엄격히 배제하십시오.',
'3. 금지키워드는 어떤 형태로도 쓰지 마십시오.',
'4. 필수기재 상단/하단 내용을 본문에 다시 쓰지 마십시오. 시스템이 자동으로 붙입니다.',
'5. 키워드는 자연스러운 문장 안에 2~3회까지. 나열식 삽입은 스팸으로 보입니다.',
'6. 연락처·URL을 본문에 반복하지 마십시오.',
'7. 특수문자 도배, 근거 없는 불안 조성 금지.',
'8. 후기가 아닌 것을 후기처럼 쓰지 마십시오.',
'',
'# 훅',
'숫자형("OO 하는 법 3가지") / 질문·직격형("OO 하려는 분들이 가장 많이 놓치는 게 있습니다") / 동네밀착형("OO동 사장님이 알려주는~")',
'동네명과 업종을 훅이나 본문 초반에 자연스럽게 넣으십시오. 동네지도 검색 노출에 직접 영향을 줍니다.',
'',
'# 톤',
'"전문적" = 이모지 거의 없이 담백하게. "친근함" = 구어체 + 이모지 소량. 뼈대(훅→본문→CTA)는 유지.',
'',
'# 사진 가이드',
'스톡 이미지·감성 인테리어 컷보다 실제 현장·실물·사람 손이 보이는 사진이 낫습니다. 프로필에 쓰인 컷과 다른 것을 추천하십시오.',
'',
'# 출력',
'아래 JSON만 출력하십시오. 코드펜스·설명·인사말 금지.',
'{"titles":["숫자형","질문형","동네밀착형"],"hook":"첫 1~2문장","body":"훅 포함 본문 전체(필수기재 제외)","photo_guide":"1~2줄",',
'"self_check":{"category":"","local_keyword_used":[],"keyword_count":0,"cta_included":true,"tone_applied":"","unverified_tokens":[]}}'
].join('\n');

var PROMPT_REVIEW_SYSTEM = [
'당신은 광고대행사의 광고 심의 담당자입니다. 당근 소식글을 검수합니다.',
'칭찬하지 말고 문제만 지적하십시오. 문제가 없으면 없다고 하십시오.',
'',
'# 1. 거짓·과장 (표시·광고의 공정화에 관한 법률)',
'정규식으로 잡히는 단어만이 아니라 "사실상 같은 뜻인 우회 표현"을 찾는 것이 당신의 역할입니다.',
'- 최상급·단정: 최고/1위/유일/최초 및 같은 뜻의 서술("여기만 합니다", "저희만큼 하는 곳은 없습니다")',
'- 효과 단정: 완치/100%/부작용 없음/즉시 해결 및 우회 표현("한 번에 끝납니다", "재발 걱정 없습니다")',
'- 허위 인증·자격 암시, 가격 기만(조건 숨긴 무료, 근거 없는 할인율)',
'',
'# 2. 업종별 추가 규제',
'의료·치과·한의원(의료법상 치료효과 단정 광고 금지), 부동산·중개(허위매물·시세 오인),',
'식품·건강기능식품(효능 표시 규제), 미용·피부(의료행위 오인).',
'해당 업종이면 담당자가 추가 확인하도록 반드시 표시하십시오. 법률 자문이 아니라 확인 지점 표시입니다.',
'',
'# 3. 사실 확인 필요',
'본문의 숫자·경력·수상·자격·장비·고객수·가격이 제공된 업체 정보에 실제로 있는지 대조하십시오.',
'제공 정보에 없는데 본문에 있으면 창작된 사실입니다. 반드시 지적하십시오.',
'',
'# 4. 플랫폼 관행 (법적 문제 아님)',
'연락처·URL 본문 반복, 후기 위장, 특수문자 도배, 근거 없는 불안 조성',
'',
'# 5. 노출 관점',
'훅 약함, 동네명·업종이 본문 초반에 없음, 소재가 섞여 불명확, 같은 키워드 4회 이상 반복',
'',
'# 판정',
'BLOCK(법적 리스크) / REVIEW(사람 사실확인 필요) / WARN(성과·관행 손해) / PASS',
'',
'# 출력 — JSON만',
'{"verdict":"","legal_issues":[{"severity":"","text":"","why":"","fix":""}],"industry_regulation":"",',
'"facts_to_verify":[],"platform_warnings":[],"exposure_notes":[],"summary":""}'
].join('\n');


/* ─────────────────────────────────────────────
 * 설치 방법
 * ─────────────────────────────────────────────
 * 1) 스프레드시트 상단 메뉴 → 확장 프로그램 → Apps Script
 * 2) 기존 코드를 모두 지우고 이 파일 전체를 붙여넣습니다.
 * 3) 저장(디스크 아이콘) → 실행을 눌러 최초 1회 권한 승인을 완료합니다.
 * 4) 프로젝트 설정(⚙) → 스크립트 속성 →
 *      ANTHROPIC_API_KEY = sk-ant-...  를 추가합니다. (코드·시트에 키를 쓰지 마세요)
 * 5) 트리거(⏰) → 트리거 추가:
 *      - 함수 onEdit / 이벤트 소스: 스프레드시트에서 / 이벤트 유형: 수정 시
 *        (단순 onEdit은 권한이 제한되므로 반드시 '설치형 트리거'로 등록하세요.
 *         메일 발송·외부 호출이 있는 함수는 단순 트리거에서 동작하지 않습니다.)
 *      - 함수 sendDailyAlerts / 시간 기반 / 일 단위 / 오전 9~10시
 * 6) 스프레드시트를 새로고침하면 상단에 "🥕 뉴스포스트" 메뉴가 나타납니다.
 */
