"""
Karrot Management 화면 구조 수집기 (읽기 전용)

회사에서 허용된 IP 환경의 PC에서 한 번만 실행하면,
자동화 코드를 쓰는 데 필요한 화면 구조(버튼/입력창 식별자)를 전부 뽑아
karrot_dump/ 폴더에 저장합니다.

■ 절대 하지 않는 것 (코스트 차감·데이터 생성 방지)
  - 제출/등록/추가/변경/조회/삭제/폐기 등 어떤 실행 버튼도 누르지 않습니다.
  - 브라우저 alert 이 뜨면 무조건 '취소'로 닫습니다.
  - 페이지 이동과 DOM 읽기, 그리고 모달 '열기'만 합니다.

■ 사용법
    pip install playwright
    playwright install chromium
    python inspect_selectors.py

  실행하면 브라우저 창이 뜹니다. 로그인 화면에서 직접 로그인하시면
  그때부터 스크립트가 알아서 화면들을 돌며 구조를 수집합니다.
  (환경변수 KARROT_ID / KARROT_PW 를 설정해두면 로그인도 자동으로 시도합니다.)
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Error as PWError
from playwright.sync_api import Page, TimeoutError as PWTimeout, sync_playwright

VERSION = "v4 (업체 지정 실행)"

BASE = os.environ.get("KARROT_BASE", "http://49.247.202.25:8080")
OUT = Path("karrot_dump")

# 이 단어가 들어간 버튼은 절대 클릭하지 않는다 (실행/과금/파괴 동작)
FORBIDDEN = (
    "제출", "등록", "추가", "생성", "변경", "조회", "삭제", "폐기", "저장",
    "확인", "전송", "업로드", "배정", "로그아웃", "탈퇴", "결제",
)
# 이 단어가 들어간 버튼은 안전하게 열어볼 수 있다 (모달 열기/탭 전환)
SAFE_OPEN = ("주소변경", "주소 변경", "비즈프로필 작업", "동네생활 작업", "내용", "메모")


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


def is_forbidden(label: str) -> bool:
    return any(word in label for word in FORBIDDEN)


# --------------------------------------------------------------------------
# DOM 수집
# --------------------------------------------------------------------------

# 페이지 안에서 실행되어 상호작용 요소를 통째로 긁어오는 스크립트.
COLLECT_JS = r"""
() => {
  const cssPath = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 6) {
      let part = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(part + '#' + el.id); break; }
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const parent = el.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };

  const dataAttrs = (el) => {
    const out = {};
    for (const a of el.attributes) {
      if (a.name.startsWith('data-') || a.name.startsWith('aria-')) out[a.name] = a.value;
    }
    return out;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const describe = (el) => {
    const info = {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || null,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      cls: el.getAttribute('class') || null,
      placeholder: el.getAttribute('placeholder') || null,
      value: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? (el.value || null) : null,
      text: (el.innerText || el.textContent || '').trim().slice(0, 80) || null,
      title: el.getAttribute('title') || null,
      href: el.getAttribute('href') || null,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      visible: visible(el),
      attrs: dataAttrs(el),
      css: cssPath(el),
    };
    if (el.tagName === 'SELECT') {
      info.options = Array.from(el.options).map(o => ({
        value: o.value, text: (o.textContent || '').trim(), selected: o.selected,
      }));
    }
    return info;
  };

  const SEL = 'button, a, input, textarea, select, [role="button"], [role="tab"], label';
  const elements = Array.from(document.querySelectorAll(SEL)).map(describe);

  // 표 구조 (헤더 + 첫 행) — 계정 목록 파악용
  const tables = Array.from(document.querySelectorAll('table')).map(t => ({
    css: cssPath(t),
    headers: Array.from(t.querySelectorAll('thead th, tr:first-child th'))
      .map(th => (th.innerText || '').trim()),
    rowCount: t.querySelectorAll('tbody tr').length,
    firstRow: Array.from(t.querySelectorAll('tbody tr'))[0]
      ? Array.from(t.querySelectorAll('tbody tr')[0].children).map(td => ({
          text: (td.innerText || '').trim().slice(0, 40),
          buttons: Array.from(td.querySelectorAll('button, a')).map(b => ({
            text: (b.innerText || '').trim(), cls: b.getAttribute('class') || null,
            href: b.getAttribute('href') || null, css: cssPath(b),
          })),
        }))
      : [],
  }));

  // 모달/다이얼로그로 보이는 컨테이너
  const modals = Array.from(document.querySelectorAll(
    '[role="dialog"], .modal, [class*="modal"], [class*="Modal"], [class*="dialog"]'
  )).filter(visible).map(m => ({ css: cssPath(m), text: (m.innerText || '').trim().slice(0, 400) }));

  // 코스트 표시 등 상태 텍스트
  const bodyText = (document.body.innerText || '').trim();

  return {
    url: location.href,
    title: document.title,
    elements,
    tables,
    modals,
    bodyTextHead: bodyText.slice(0, 1500),
  };
};
"""


def capture(page: Page, key: str, note: str = "") -> dict:
    """현재 화면의 구조 + 스크린샷 + 원본 HTML 저장."""
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except PWTimeout:
        pass
    page.wait_for_timeout(600)

    data = page.evaluate(COLLECT_JS)
    data["key"] = key
    data["note"] = note

    (OUT / "html").mkdir(parents=True, exist_ok=True)
    (OUT / "shot").mkdir(parents=True, exist_ok=True)
    try:
        (OUT / "html" / f"{key}.html").write_text(page.content(), encoding="utf-8")
    except PWError:
        pass
    try:
        page.screenshot(path=str(OUT / "shot" / f"{key}.png"), full_page=True)
    except PWError:
        page.screenshot(path=str(OUT / "shot" / f"{key}.png"))

    log(f"수집 완료: {key}  ({len(data['elements'])}개 요소, 표 {len(data['tables'])}개)")
    return data


# --------------------------------------------------------------------------
# 로그인
# --------------------------------------------------------------------------

def ensure_login(page: Page) -> None:
    page.goto(f"{BASE}/karrotFront/login", wait_until="domcontentloaded")

    user_id, pw = os.environ.get("KARROT_ID"), os.environ.get("KARROT_PW")
    if user_id and pw:
        try:
            pw_box = page.locator("input[type=password]").first
            pw_box.wait_for(state="visible", timeout=5000)
            # 비밀번호 칸 앞에 있는 첫 번째 텍스트 입력칸을 아이디 칸으로 본다
            id_box = page.locator("input:not([type=password]):not([type=hidden])").first
            id_box.fill(user_id)
            pw_box.fill(pw)
            btn = page.get_by_role("button", name=re.compile("로그인"))
            if btn.count():
                btn.first.click()
            else:
                pw_box.press("Enter")
            log("자동 로그인 시도")
        except (PWTimeout, PWError) as exc:
            log(f"자동 로그인 실패({exc.__class__.__name__}) — 직접 로그인해 주세요")

    print(
        "\n  >> 지금 열려 있는 '이 스크립트가 띄운 브라우저 창'에서 로그인해 주세요."
        "\n     (평소 쓰던 크롬/엣지가 아니라, 방금 새로 뜬 창입니다.)"
        "\n     로그인되면 자동으로 진행됩니다.\n",
        flush=True,
    )

    for tick in range(300):  # 최대 5분 대기
        # page.url 은 이벤트가 처리돼야 갱신되므로, 실제 페이지에 물어봐서 확인한다.
        try:
            current = page.evaluate("() => location.href")
        except PWError:
            current = page.url
        if "/login" not in current:
            log(f"로그인 확인됨 → {current}")
            return
        if tick and tick % 10 == 0:
            log(f"대기 중... (현재 주소: {current})")
        page.wait_for_timeout(1000)

    raise RuntimeError("5분 안에 로그인이 확인되지 않았습니다.")


# --------------------------------------------------------------------------
# 안전한 모달 열기
# --------------------------------------------------------------------------

def try_open_modal(page: Page, label: str, key: str, results: list) -> None:
    """실행 버튼이 아닌 '열기' 버튼만 눌러 모달 구조를 수집하고 ESC로 닫는다."""
    if is_forbidden(label):
        log(f"건너뜀(금지어 포함): {label}")
        return
    try:
        target = page.get_by_role("button", name=re.compile(re.escape(label))).first
        if target.count() == 0:
            target = page.locator(f"text={label}").first
        if target.count() == 0:
            return
        target.click(timeout=3000)
        page.wait_for_timeout(1000)
        results.append(capture(page, key, note=f"'{label}' 클릭으로 열린 상태"))
    except (PWTimeout, PWError) as exc:
        log(f"모달 열기 실패: {label} ({exc.__class__.__name__})")
    finally:
        try:
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
        except PWError:
            pass


def open_fab(page: Page, key: str, results: list) -> None:
    """우하단 + 플로팅 버튼을 눌러 추가 모달 구조만 수집 (제출 안 함)."""
    try:
        buttons = page.locator("button, a[role=button], div[role=button]")
        count = min(buttons.count(), 200)
        # 화면 우하단에 있는 작은 원형 버튼을 FAB로 추정
        vw = page.viewport_size["width"] if page.viewport_size else 1280
        vh = page.viewport_size["height"] if page.viewport_size else 720
        for i in range(count):
            b = buttons.nth(i)
            try:
                box = b.bounding_box()
            except PWError:
                continue
            if not box:
                continue
            if box["x"] > vw * 0.85 and box["y"] > vh * 0.7 and box["width"] < 90:
                text = (b.inner_text() or "").strip()
                if is_forbidden(text):
                    continue
                b.click(timeout=3000)
                page.wait_for_timeout(1200)
                results.append(capture(page, key, note="우하단 + 버튼으로 열린 모달"))
                page.keyboard.press("Escape")
                page.wait_for_timeout(400)
                return
    except (PWTimeout, PWError) as exc:
        log(f"FAB 열기 실패 ({exc.__class__.__name__})")


# --------------------------------------------------------------------------
# 메인
# --------------------------------------------------------------------------

def current_url(page: Page) -> str:
    try:
        return page.evaluate("() => location.href")
    except PWError:
        return page.url


# 화면 안에 흩어져 있는 id 값을 최대한 긁어모은다.
# (링크 href / onclick / data-* / 인라인 스크립트 / 페이지 HTML 전체)
SCAN_JS = r"""
(name) => {
  const found = new Set();
  const re = new RegExp(name + '\\s*[=:]\\s*["\']?(\\d+)', 'g');
  const push = (text) => {
    if (!text) return;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  };
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) push(a.value);
  }
  push(document.documentElement.outerHTML);
  return Array.from(found);
};
"""


def scan_id(page: Page, name: str) -> str | None:
    """페이지 어딘가에 박혀 있는 businessId / tokenId 같은 값을 찾아본다."""
    try:
        found = page.evaluate(SCAN_JS, name)
    except PWError:
        found = []
    if found:
        log(f"{name} 후보 {len(found)}개 발견 → {found[0]} 사용")
        return found[0]
    return None


def id_from_url(url: str, name: str) -> str | None:
    """주소에서 쿼리 파라미터 값을 읽는다. 'id' 가 'tokenId' 안에 걸리지 않도록 [?&] 를 요구한다."""
    m = re.search(rf"[?&]{name}=(\d+)", url)
    return m.group(1) if m else None


def wait_for_url(page: Page, name: str, guide: str, minutes: int = 5) -> str | None:
    """사용자가 직접 화면을 이동해 주기를 기다린 뒤, 주소에서 값을 읽는다."""
    print(f"\n  >> {guide}\n", flush=True)
    for tick in range(minutes * 60):
        value = id_from_url(current_url(page), name)
        if value:
            log(f"{name} = {value} 확인됨")
            return value
        if tick and tick % 15 == 0:
            log(f"대기 중... (현재 주소: {current_url(page)})")
        page.wait_for_timeout(1000)
    log(f"{minutes}분 동안 {name} 를 얻지 못해 이 단계는 건너뜁니다.")
    return None


def click_first_text(page: Page, label: str) -> bool:
    """표 안의 특정 텍스트 버튼/링크를 눌러 화면 이동을 시도한다 (금지어는 제외)."""
    if is_forbidden(label):
        return False
    before = current_url(page)
    for locator in (
        page.get_by_role("button", name=re.compile(re.escape(label))),
        page.get_by_role("link", name=re.compile(re.escape(label))),
        page.locator(f"text={label}"),
    ):
        try:
            if locator.count() == 0:
                continue
            locator.first.click(timeout=3000)
            page.wait_for_timeout(2500)
            if current_url(page) != before:
                return True
        except (PWTimeout, PWError):
            continue
    return False


def save_report(results: list[dict], sample: dict) -> None:
    OUT.mkdir(exist_ok=True)
    report = {
        "version": VERSION,
        "collectedAt": datetime.now().isoformat(timespec="seconds"),
        "base": BASE,
        "sample": sample,
        "pages": results,
    }
    (OUT / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log(f"report.json 저장 ({len(results)}개 화면)")


# --------------------------------------------------------------------------
# 메인
# --------------------------------------------------------------------------

def collect(
    page: Page,
    results: list[dict],
    sample: dict,
    given_business: str | None = None,
    given_token: str | None = None,
) -> None:
    print("\n[2/6] 업체 목록")
    page.goto(f"{BASE}/karrotFront/companies", wait_until="domcontentloaded")
    results.append(capture(page, "01_companies", "업체 목록"))
    open_fab(page, "02_companies_add_modal", results)
    save_report(results, sample)

    # --- businessId 확보: ⓪ 실행 인자 → ① 화면 스캔 → ② '동네생활' 클릭 → ③ 사용자 직접 이동 ---
    business_id = given_business
    if business_id:
        log(f"실행 인자로 받은 businessId = {business_id} 사용")
    if not business_id:
        business_id = scan_id(page, "businessId")
    if not business_id:
        log("화면에서 못 찾음 → 첫 번째 업체의 [동네생활] 버튼을 눌러 봅니다")
        if click_first_text(page, "동네생활"):
            business_id = id_from_url(current_url(page), "businessId")
    if not business_id:
        business_id = wait_for_url(
            page, "businessId",
            "업체 목록에서 아무 업체나 하나 골라 [동네생활] 버튼을 눌러 주세요.\n"
            "     (계정이 여러 개 있는 업체면 더 좋습니다. [조회] 버튼은 누르지 마세요 — 코스트가 깎입니다.)",
        )
    if not business_id:
        log("업체 화면을 열지 못해 여기까지만 수집합니다.")
        return
    sample["businessId"] = business_id

    print("\n[3/6] 업체 상세 (동네생활 / 비즈프로필)")
    page.goto(f"{BASE}/karrotFront/index?businessId={business_id}&usageType=post",
              wait_until="domcontentloaded")
    results.append(capture(page, "03_business_dongne", "업체 상세 · 동네생활 탭"))
    open_fab(page, "04_token_add_modal", results)
    try_open_modal(page, "주소변경", "05_address_change_modal", results)
    try_open_modal(page, "비즈프로필 작업", "06_business_bizprofile", results)
    save_report(results, sample)

    # --- tokenId 확보 ---
    token_id = given_token
    if token_id:
        log(f"실행 인자로 받은 tokenId = {token_id} 사용")
    if not token_id:
        token_id = scan_id(page, "tokenId")
    if not token_id:
        token_id = wait_for_url(
            page, "tokenId",
            "계정 목록에서 계정 하나의 작업 화면으로 들어가 주세요 (보통 [선택] 버튼).\n"
            "     이 업체에 계정이 하나도 없으면 [선택] 버튼도 없습니다.\n"
            "     그럴 땐 Ctrl+C 로 끄고, 계정이 있는 업체 번호로 다시 실행하세요:\n"
            "       python inspect_selectors.py 1107\n"
            "     주소창에 tokenId= 가 나타나면 자동으로 이어집니다.\n"
            "     * [조회]는 코스트를 씁니다. 그 버튼은 스크립트도 누르지 않고, 사장님도 누르지 마세요.\n"
     "     * [선택]이 코스트를 쓰는지 제가 확신할 수 없어 자동으로 누르지 않았습니다. 판단해서 눌러 주세요.",
        )
    if not token_id:
        log("계정 화면을 열지 못해 여기까지만 수집합니다.")
        return
    sample["tokenId"] = token_id
    sample["nickname"] = (re.search(r"nickname=([^&]+)", current_url(page)) or [None, ""])[1]

    print("\n[4/6] 게시글 작성 / 목록")
    page.goto(f"{BASE}/karrotFront/write?tokenId={token_id}&businessId={business_id}",
              wait_until="domcontentloaded")
    results.append(capture(page, "07_write", "게시글 작성 (등록하지 않음)"))

    page.goto(f"{BASE}/karrotFront/posts?tokenId={token_id}", wait_until="domcontentloaded")
    results.append(capture(page, "08_posts", "내 게시글 목록"))
    save_report(results, sample)

    print("\n[5/6] 게시글 상세 (댓글 / 대댓글)")
    post_id = None
    if click_first_text(page, "댓글"):
        post_id = id_from_url(current_url(page), "id")
    if not post_id:
        post_id = scan_id(page, r"post\?id")
    if post_id:
        page.goto(
            f"{BASE}/karrotFront/post?id={post_id}&tokenId={token_id}&businessId={business_id}",
            wait_until="domcontentloaded",
        )
        results.append(capture(page, "09_post_detail", "게시글 상세 · 댓글 입력바"))
        try_open_modal(page, "답글", "10_reply_form", results)
        sample["postId"] = post_id
    else:
        log("이 계정에는 게시글이 없어 상세 화면은 건너뜁니다.")
    save_report(results, sample)

    print("\n[6/6] 후기 관리")
    page.goto(
        f"{BASE}/karrotFront/reviews?tokenId={token_id}"
        f"&nickname={sample.get('nickname') or ''}&businessId={business_id}",
        wait_until="domcontentloaded",
    )
    results.append(capture(page, "11_reviews", "후기 관리"))
    save_report(results, sample)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    results: list[dict] = []
    sample: dict = {}

    args = [a for a in sys.argv[1:] if a.isdigit()]
    given_business = args[0] if len(args) > 0 else None
    given_token = args[1] if len(args) > 1 else None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--start-maximized"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # 안전장치: alert/confirm 이 떠도 절대 '확인'을 누르지 않는다
        page.on("dialog", lambda d: (log(f"[dialog 무시] {d.message}"), d.dismiss()))

        print(f"\n===== 화면 구조 수집기 {VERSION} =====")
        if given_business:
            print(f"      지정된 업체 businessId = {given_business}")
        else:
            print("      (특정 업체를 지정하려면:  python inspect_selectors.py 1107 )")
        try:
            print("\n[1/6] 로그인")
            ensure_login(page)
            collect(page, results, sample, given_business, given_token)
        except KeyboardInterrupt:
            print("\n사용자가 중단했습니다. 지금까지 모은 내용을 저장합니다.")
        except Exception as exc:  # 어떤 오류가 나도 결과는 남긴다
            print(f"\n[오류] {exc.__class__.__name__}: {exc}")
            print("여기까지 모은 내용을 저장합니다.")
        finally:
            save_report(results, sample)

        print(f"\n완료. '{OUT.resolve()}' 폴더를 확인해 주세요.")
        print("  report.json  — 화면별 버튼/입력창 구조 (이 파일이 핵심)")
        print("  html/        — 화면별 원본 HTML")
        print("  shot/        — 화면별 스크린샷")
        input("\n  엔터를 누르면 브라우저를 닫습니다... ")
        ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
