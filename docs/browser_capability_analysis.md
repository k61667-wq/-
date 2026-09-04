# 브라우저 환경에서 Claude 코딩으로 구현·제어 가능한 기능 범위 분석

대상: `https://karrot.evenit.co.kr/` (당근 AI CMS — 관리자 로그인 페이지)
작성일: 2026-09-04
검증: 사용자 PC 에서 `tools/run_probe.mjs` 실측 (`reports/karrot/report.json`, 2026-09-04T08:22Z, 로그인 전 상태)
검증 도구: `tools/browser_capability_probe.js`, `tools/browser_capability_probe.html`, `tools/run_probe.mjs`

---

## 0. 결론

1. **실측 완료 (로그인 전 페이지 한정).** 사용자 PC 의 Playwright 헤드리스 Chromium 으로 `https://karrot.evenit.co.kr/` 를 실측했다. 대상은 **당근 AI CMS 관리자 로그인 화면**이며, 아이디/비밀번호 입력 후 진입하는 **로그인 후 앱 화면은 미측정**이다. 아래 사이트 고유 판정은 로그인 전 기준이고, 로그인 후 추가 확인이 필요하다(4장 15번).
2. **핵심 실측 결과.**
   - HTTP 200, 리다이렉트 없음. **Cloudflare** 앞단(`server: cloudflare`, `static.cloudflareinsights.com` 분석 스크립트 1개 로드).
   - 인증 쿠키 `cf_clearance` 1개: **HttpOnly·Secure·SameSite=None** → JS 로 값 열람 불가. 로그인 세션도 서버 쿠키 방식일 가능성이 높다.
   - **CSP 응답 헤더 없음.** 따라서 사이트/주입 코드 모두 인라인 `<script>`·`eval`·blob Worker 가 허용된다(프로브 `csp.*` 전부 `ok`).
   - **`X-Frame-Options: DENY`** → 이 페이지를 iframe 에 삽입 불가(타 사이트에서 프레임으로 감싸 조작하는 경로 차단).
   - ESM 모듈 스크립트 사용, 알려진 프레임워크 전역(React/Vue/Next 등) 미검출 → 자체 번들. 로그인 후 앱 코드가 별도 로드되는 구조로 추정.
   - DOM 43개 요소, 폼 1개(text 아이디 + password), 링크 0, 버튼 1 → 로그인은 JS `fetch` 로 전송하는 SPA 로그인으로 추정.
   - localStorage·sessionStorage·IndexedDB·CacheStorage 모두 읽기·쓰기 가능(현재 키 0), Service Worker·manifest 없음, HTTPS 보안 컨텍스트.
3. 제어 가능 범위는 **"어디서 코드를 실행하느냐"** 로 결정된다. 3개 계층으로 나뉜다.
   - **계층 A: 사이트 소유 코드**(`karrot.evenit.co.kr` 에 배포되는 HTML/JS) → 동일 출처 안에서 거의 전부 가능.
   - **계층 B: 외부 주입 코드**(DevTools 콘솔, 북마클릿, 확장 프로그램, Playwright) → 페이지 DOM·저장소·동일 출처 네트워크는 가능, 사이트 CSP와 브라우저 권한 정책의 제약을 받음.
   - **계층 C: 타 출처 페이지**(당근 비즈니스 `business.daangn.com`, 네이버, 숨고 등) → 어떤 계층에서도 **DOM 직접 제어 불가**. 공식 API·OAuth·사용자 수동 조작만 가능.
3. Claude Code(현재 세션)가 브라우저에 대해 할 수 있는 것은 **코드 작성 + 헤드리스 Chromium(Playwright 1.56) 실행**이며, 사용자의 실제 브라우저 탭·로그인 세션·확장 프로그램을 직접 조작하는 능력은 없다.

---

## 1. 실행 환경별 능력 (Claude Code 관점)

| 항목 | 현재 세션(클라우드 샌드박스) | 사용자 PC에서 실행 시 |
|---|---|---|
| `karrot.evenit.co.kr` 접속 | ✗ 프록시 정책 차단(403) | ✓ 브라우저·Playwright 모두 가능 |
| 헤드리스 Chromium 실행 | ✓ Playwright 1.56.1 + Chromium 사전 설치 | ✓ `npm i playwright` 후 |
| 사용자 브라우저 탭 제어 | ✗ | ✗ (Playwright 는 별도 브라우저 인스턴스를 띄움. 확장 프로그램/DevTools 프로토콜 연결은 사용자가 직접 설정) |
| 로그인 세션 재사용 | ✗ | △ `--save-state` 로 수동 로그인 후 storageState 저장·재사용 |
| 페이지 스크린샷·PDF | ✓ (접속 가능한 URL 한정) | ✓ |
| 응답 헤더(CSP, XFO, Set-Cookie) 확인 | ✓ (접속 가능한 URL 한정) | ✓ |
| HttpOnly 쿠키 열람 | Playwright `context.cookies()` 로 이름·속성만 확인(값은 러너에서 마스킹) | 동일 |
| 사이트 소스 수정·배포 | ✗ 저장소에 사이트 코드 없음 | 사이트 저장소·배포 권한이 있어야 가능 |

---

## 2. 브라우저 컨텍스트 내 기능 범위 — 가능 / 불가능

범례: **A** 사이트 소유 코드 / **B** 외부 주입 코드 / **C** 타 출처 페이지 대상

### 2-1. DOM

| 기능 | A | B | C | 비고 |
|---|---|---|---|---|
| 요소 조회·생성·삭제·속성 변경 | ✓ | ✓ | ✗ | C 는 `SecurityError` |
| `innerHTML` 주입 | ✓ | ✓ | ✗ | Trusted Types 강제 시 A/B 모두 차단 |
| MutationObserver / Resize / Intersection | ✓ | ✓ | ✗ | |
| 합성 이벤트 발송(`dispatchEvent`) | ✓ | ✓ | ✗ | `isTrusted=false`. 일부 프레임워크·브라우저 기본 동작(파일 선택, 팝업)은 반응하지 않음 |
| 열린 Shadow DOM 접근 | ✓ | ✓ | ✗ | closed shadow root 는 A/B 모두 불가 |
| 동일 출처 iframe 내부 DOM | ✓ | ✓ | – | |
| 교차 출처 iframe 내부 DOM | ✗ | ✗ | ✗ | `postMessage` 로 상대가 협조할 때만 통신 |
| 인라인 `<script>` 주입 실행 | CSP 따름 | CSP 따름 | ✗ | `script-src` 에 `'unsafe-inline'`/nonce 없으면 차단 |
| `eval` / `new Function` | CSP 따름 | 콘솔·CDP 주입 코드는 CSP 면제 | ✗ | 프로브 결과 해석 시 주의(3장) |

### 2-2. 저장소·인증

| 기능 | A | B | C | 비고 |
|---|---|---|---|---|
| localStorage / sessionStorage 읽기·쓰기 | ✓ | ✓ | ✗ | 출처 단위 격리 |
| IndexedDB / CacheStorage | ✓ | ✓ | ✗ | CacheStorage 는 보안 컨텍스트(HTTPS) 필요 |
| `document.cookie` 읽기·쓰기 | ✓ | ✓ | ✗ | **HttpOnly 쿠키는 어떤 JS 에서도 읽기 불가** |
| 세션 토큰 탈취·위조 | ✗ | ✗ | ✗ | 기술적으로 막혀 있고, 시도 자체가 약관·법 위반 |
| Service Worker 등록 | ✓ | △ 스코프·CSP `worker-src` 제약 | ✗ | |

### 2-3. 네트워크

| 기능 | A | B | C | 비고 |
|---|---|---|---|---|
| 동일 출처 `fetch`/XHR (쿠키 포함) | ✓ | ✓ | – | 사이트 내부 API 는 여기서 호출 |
| 교차 출처 `fetch` | 상대 CORS 허용 시 ✓ | 동일 | 동일 | `mode:"no-cors"` 는 응답 읽기 불가 |
| 교차 출처 + 자격증명(`credentials:"include"`) | 상대가 `Access-Control-Allow-Credentials` + 명시 Origin 허용 시만 | 동일 | 동일 | 당근·네이버·숨고 API 는 공식 허용 없이는 불가 |
| WebSocket / SSE / sendBeacon | ✓ | ✓ | – | CSP `connect-src` 제약 |
| 브라우저 요청 가로채기·수정 | Service Worker 로 동일 스코프만 | 확장 프로그램(declarativeNetRequest) 필요 | ✗ | |
| 응답 헤더 전체 열람 | 동일 출처 fetch 로 대부분 가능 | 동일 | ✗ | `Set-Cookie` 는 JS 에 노출되지 않음 |

### 2-4. 권한·사용자 제스처가 필요한 API (자동화 불가 영역)

| API | 조건 | 자동 호출 |
|---|---|---|
| 클립보드 쓰기 `navigator.clipboard.writeText` | 사용자 클릭/키 입력 직후 + HTTPS | ✗ (제스처 없이는 `NotAllowedError`) |
| 클립보드 읽기 | 권한 프롬프트 + 제스처 | ✗ |
| `window.open` 팝업 | 제스처 | ✗ (팝업 차단) |
| 파일 선택 `input[type=file].click()`, File System Access | 제스처 | ✗ (파일 경로를 코드로 지정 불가. Playwright `setInputFiles` 는 가능) |
| 다운로드 `<a download>` | 대부분 허용, 일부 환경 제스처 요구 | △ |
| 전체화면, 알림 권한 요청, 위치, 카메라/마이크 | 제스처 + 권한 프롬프트 | ✗ |
| `window.print()` | 호출은 가능, 인쇄 대화상자는 사용자가 확인 | △ (Playwright `page.pdf()` 는 헤드리스에서 무대화상자 출력) |
| 소리 있는 자동재생 | 제스처 | ✗ |

### 2-5. 페이지 밖 (브라우저·OS)

| 기능 | 가능 여부 |
|---|---|
| 다른 탭·창의 DOM 제어 | ✗ (동일 출처 `window.open` 반환 핸들 또는 BroadcastChannel 로 협조 통신만) |
| 브라우저 설정·확장 설치·프로필 접근 | ✗ |
| 로컬 파일 시스템 임의 읽기·쓰기 | ✗ (사용자가 고른 파일/폴더 핸들만) |
| 스크린샷(페이지 자체 촬영) | ✗ 표준 API 없음. `getDisplayMedia` 는 제스처+선택 UI. Playwright 는 ✓ |
| 클립보드 감시, 키 입력 감시(페이지 밖) | ✗ |
| 백그라운드 상시 실행 | ✗ 탭 닫히면 종료. Push + Service Worker 는 서버 인프라 필요 |

### 2-6. 당근·플랫폼 연동 관점 (사이트 목적 기준)

| 목표 | 가능 경로 | 불가능·금지 경로 |
|---|---|---|
| 당근 비즈프로필 데이터 표시 | 공식 API/OAuth 가 제공되는 범위, 또는 사용자가 CSV/화면 내용을 직접 입력·업로드 | `business.daangn.com` 을 iframe 에 넣고 DOM 읽기(차단), 사용자 쿠키로 대리 호출(차단·약관 위반) |
| 소식·광고 자동 게시 | 공식 파트너 API 가 있을 때만(현재 미확인) | 브라우저 자동화 봇으로 당근 앱/웹 조작 → 계정 정지 리스크 |
| 숨고·크몽 요청 수신 | 이메일 알림 트리거(기존 `docs/자동화_구축가이드.md` 방식) | 플랫폼 페이지 스크래핑·자동 응답 전송 |
| 고객 화면 캡처·리포트 | Playwright 로 **자사 사이트** 캡처 후 PDF | 타 플랫폼 로그인 화면 자동 캡처(약관) |

> 당근·네이버·숨고의 공개 API 제공 여부와 범위는 이 세션에서 확인하지 않았다. 확정 표현을 쓰지 말고 각 플랫폼 개발자 문서로 검증한 뒤 설계할 것.

---

## 3. 검증 도구 사용법

### 3-1. 콘솔 프로브 (`tools/browser_capability_probe.js`)

1. 대상 페이지를 크롬에서 열고 F12 → Console.
2. 파일 내용 전체를 붙여넣고 Enter. 약 1~2초 후 `console.table` 로 94개 항목이 출력된다.
3. `copy(JSON.stringify(window.__BROWSER_PROBE_RESULT__))` 로 결과 복사.
4. 필요 시 파일 상단 `CONFIG.crossOriginTestUrl` 에 외부 API URL 을 넣으면 CORS 항목이 실측된다.

읽기 전용 원칙: 클릭·폼 제출·이동 없음. 저장소 검사는 임시 키를 쓰고 즉시 삭제한다.

상태 값 의미:

| status | 의미 |
|---|---|
| `ok` | 현재 컨텍스트에서 호출 성공 |
| `blocked` | CSP·권한·교차 출처 정책으로 차단됨 |
| `unavailable` | 브라우저가 API 를 제공하지 않음 |
| `info` | 판정 대상이 아닌 관찰값(프레임워크 흔적, 권한 상태 등) |
| `skipped` | CONFIG 로 꺼져 있거나 입력값 필요 |

해석 주의:
- `eval()`·`new Function()` 은 콘솔/CDP 로 주입한 코드에서는 CSP 와 무관하게 성공한다. 페이지 번들 코드의 실제 제약은 `fetch same-origin` 항목의 `content-security-policy` 헤더 값으로 판단한다.
- `inline <script> injection` 과 `Worker from blob:` 은 실제 CSP 적용을 받으므로 신뢰할 수 있다. (로컬 검증: `script-src 'self'; worker-src 'none'` 서버에서 두 항목만 `blocked` 로 판정됨을 확인.)
- `document.cookie` 는 HttpOnly 가 아닌 쿠키 이름만 보여준다. 인증 쿠키가 안 보인다고 없는 것이 아니다.

### 3-2. 하네스 페이지 (`tools/browser_capability_probe.html`)

```bash
cd tools && python3 -m http.server 8765
# 브라우저에서 http://localhost:8765/browser_capability_probe.html
```

- "이 페이지에서 실행": 하네스 자체 출처에서 프로브를 실행해 브라우저 기본 능력을 확인.
- "iframe 로드": 대상 URL 을 iframe 에 넣고 부모에서 `contentDocument` 접근을 시도. **차단되는 것이 정상**이며, 프레임이 비어 있으면 대상이 `X-Frame-Options`/`frame-ancestors` 로 삽입을 거부한 것이다.
- `file://` 로 열면 fetch 가 막혀 프로브 로드가 실패한다. 반드시 HTTP 로 서빙.

### 3-3. Playwright 러너 (`tools/run_probe.mjs`) — 헤더·쿠키·네트워크까지 확인

```bash
npm i playwright && npx playwright install chromium
node tools/run_probe.mjs https://karrot.evenit.co.kr/ --out reports/karrot
# 로그인 후 상태로 검사하려면
node tools/run_probe.mjs https://karrot.evenit.co.kr/ --headed --save-state auth.json   # 창에서 로그인 후 Enter
node tools/run_probe.mjs https://karrot.evenit.co.kr/ --storage-state auth.json --out reports/karrot_auth
```

산출: `report.json`(응답 헤더, 쿠키 이름·HttpOnly 여부, 호스트별 요청 수, 실패 요청, 프로브 결과), `screenshot.png`, `console.log`.
쿠키 값은 저장하지 않는다(`valueLength` 만 기록).

---

## 4. 체크리스트 (실측 결과 — 로그인 전 기준)

기준 데이터: `reports/karrot/report.json` (2026-09-04, HeadlessChrome 151, 로그인 전).

| # | 확인 항목 | 실측 결과 | 판정 |
|---|---|---|---|
| 1 | HTTPS / `isSecureContext` | `true` | ✅ 보안 컨텍스트. 클립보드·SW·CacheStorage 등 사용 가능 |
| 2 | 프레임워크·번들러 | 알려진 전역 없음, `esm-scripts`(module), 스크립트 호스트 = 자사 + Cloudflare Insights | ✅ 자체 ESM 번들. 로그인 후 앱 코드 별도 로드 추정 |
| 3 | 헤더 CSP 존재·`script-src` | **CSP 헤더 없음** | ⚠️ 인라인·eval·동적 스크립트 무제한 허용. 로그인 후 화면도 동일하면 XSS 방어면에서 취약 |
| 4 | 인라인 스크립트 주입 | `csp.inlineScript = allowed`, blob Worker `allowed` | ✅ (CSP 없음의 결과) |
| 5 | `X-Frame-Options` / `frame-ancestors` | `X-Frame-Options: DENY` | ✅ iframe 삽입 차단. 타 사이트에서 프레임으로 감싸 조작 불가 |
| 6 | 인증 방식 | 쿠키 `cf_clearance` HttpOnly·Secure·SameSite=None, localStorage 키 0 | ✅ 서버 쿠키 기반. 토큰이 localStorage 에 없음(로그인 전) |
| 7 | 사이트 내부 API 경로·호스트 | 요청 호스트 = `karrot.evenit.co.kr`(9), `static.cloudflareinsights.com`(1) | △ 로그인 전이라 앱 API 미노출. 로그인 후 재측정 필요 |
| 8 | 외부 API CORS 허용 | 미측정(`CONFIG.crossOriginTestUrl` 미설정) | ☐ 필요 시 설정 후 측정 |
| 9 | Service Worker | 등록 0, controller 없음 | ✅ 오프라인·백그라운드 캐시 미사용 |
| 10 | 교차 출처 iframe | 페이지 내 iframe 없음(`about:blank` 만) | ✅ 외부 프레임 임베드 없음 |
| 11 | 클립보드·다운로드·인쇄 API | clipboard(read/write) · FSA · download · print · payment · getUserMedia 전부 present | ✅ API 존재. 실제 호출은 사용자 제스처·권한 필요 |
| 12 | 권한 상태 | notifications/clipboard = prompt, geo/camera/mic = denied(헤드리스 기본) | △ denied 는 헤드리스 특성. 실제 브라우저에선 prompt |
| 13 | 콘솔 오류·실패 요청 | consoleError 0, 실패 1건(프로브의 HEAD 자기요청이 Cloudflare 에서 ERR_ABORTED — 사이트 오류 아님) | ✅ 페이지 자체 오류 없음 |
| 14 | 폼 전송 대상 | 폼 1개 `GET karrot.evenit.co.kr/`, input text+password, 버튼 1 | △ 기본 action 은 자기 자신. 실제 로그인은 JS fetch 추정 |
| 15 | 로그인 후 추가 API·저장소 | **미측정** | ☐ `--headed --save-state auth.json` 로 로그인 후 재실행 필요 |

---

## 5. 리스크

| 구분 | 내용 | 대응 |
|---|---|---|
| 범위 | 로그인 전 화면만 실측됨. 로그인 후 앱의 API·저장소·프레임워크는 미측정 | 4장 15번 절차로 인증 후 재측정 |
| 보안 | 로그인 페이지에 CSP 헤더가 없음. 로그인 후 화면도 같다면 XSS·써드파티 스크립트 주입 방어가 약함 | 사이트 배포 권한이 있다면 `Content-Security-Policy` 헤더 도입 검토(별도 사안) |
| 정책 | 당근·네이버·숨고 페이지를 브라우저 자동화로 조작하는 설계는 약관 위반·계정 정지 위험 | 공식 API·OAuth 범위 확인, 없으면 사람이 최종 실행하는 반자동 구조 유지 |
| 보안 | 프로브·러너는 읽기 전용이지만 결과 JSON 에 UA·쿠키 이름·API 호스트가 포함됨 | 외부 공유 전 `report.json` 검토 |
| 해석 오류 | 콘솔 주입 코드는 CSP `unsafe-eval` 제약을 우회하므로 `eval` 결과를 과대 해석할 수 있음 | 헤더 CSP 값으로 판단 |
| 환경 | 로컬 파일(`file://`) 로 하네스를 열면 fetch 차단으로 오작동 | HTTP 서빙 |

---

## 6. Action Item

1. ✅ 완료 — 로그인 전 실측 및 4장 체크리스트 확정(`reports/karrot/report.json`).
2. 로그인 후 앱 범위 확인: `node tools/run_probe.mjs https://karrot.evenit.co.kr/ --headed --save-state auth.json` 실행 → 창에서 로그인 후 Enter → `--storage-state auth.json --out reports/karrot_auth` 로 재실행해 1~14 항목 비교. (`auth.json` 은 세션 쿠키를 담으므로 커밋·공유 금지, `.gitignore` 처리 권장)
3. 당근 비즈니스·네이버·숨고 연동 요구가 있다면 각 플랫폼 공식 API 문서 유무를 먼저 확인하고, 없는 항목은 반자동(초안 생성 → 사람이 전송) 구조로 설계.
4. 이 세션 환경에서 사이트 접속이 필요하면 Claude Code 웹 환경 설정의 네트워크 정책에 `karrot.evenit.co.kr` 허용을 추가.
