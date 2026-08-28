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
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Error as PWError
from playwright.sync_api import Page, TimeoutError as PWTimeout, sync_playwright

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
    time.sleep(0.6)

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

    print("\n  >> 브라우저에서 로그인해 주세요. 로그인되면 자동으로 진행됩니다.\n", flush=True)
    for _ in range(300):  # 최대 5분 대기
        if "/login" not in page.url:
            log(f"로그인 확인됨 → {page.url}")
            return
        time.sleep(1)
    sys.exit("로그인이 확인되지 않아 중단합니다.")


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
        time.sleep(1.0)
        results.append(capture(page, key, note=f"'{label}' 클릭으로 열린 상태"))
    except (PWTimeout, PWError) as exc:
        log(f"모달 열기 실패: {label} ({exc.__class__.__name__})")
    finally:
        try:
            page.keyboard.press("Escape")
            time.sleep(0.4)
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
                time.sleep(1.2)
                results.append(capture(page, key, note="우하단 + 버튼으로 열린 모달"))
                page.keyboard.press("Escape")
                time.sleep(0.4)
                return
    except (PWTimeout, PWError) as exc:
        log(f"FAB 열기 실패 ({exc.__class__.__name__})")


# --------------------------------------------------------------------------
# 메인
# --------------------------------------------------------------------------

def first_param(page: Page, pattern: str) -> str | None:
    """현재 페이지의 링크들에서 지정한 쿼리 파라미터의 첫 값을 찾는다."""
    hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    for href in hrefs:
        if not href:
            continue
        m = re.search(pattern, href)
        if m:
            return m.group(1)
    # 링크가 아니라 JS 이동일 수 있으므로 페이지 HTML 전체도 훑는다
    m = re.search(pattern, page.content())
    return m.group(1) if m else None


def main() -> None:
    OUT.mkdir(exist_ok=True)
    results: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--start-maximized"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # 안전장치: alert/confirm 이 떠도 절대 '확인'을 누르지 않는다
        page.on("dialog", lambda d: (log(f"[dialog 무시] {d.message}"), d.dismiss()))

        print("\n[1/6] 로그인")
        ensure_login(page)

        print("\n[2/6] 업체 목록")
        page.goto(f"{BASE}/karrotFront/companies", wait_until="domcontentloaded")
        results.append(capture(page, "01_companies", "업체 목록"))
        open_fab(page, "02_companies_add_modal", results)

        business_id = first_param(page, r"businessId=(\d+)")
        if not business_id:
            sys.exit("업체 ID를 찾지 못했습니다. 업체 목록이 비어 있는지 확인해 주세요.")
        log(f"샘플 businessId = {business_id}")

        print("\n[3/6] 업체 상세 (동네생활 / 비즈프로필)")
        page.goto(f"{BASE}/karrotFront/index?businessId={business_id}&usageType=post",
                  wait_until="domcontentloaded")
        results.append(capture(page, "03_business_dongne", "업체 상세 · 동네생활 탭"))
        open_fab(page, "04_token_add_modal", results)
        try_open_modal(page, "주소변경", "05_address_change_modal", results)
        try_open_modal(page, "비즈프로필 작업", "06_business_bizprofile", results)

        token_id = first_param(page, r"tokenId=(\d+)")
        nickname = first_param(page, r"nickname=([^&\"']+)")
        if not token_id:
            log("계정(토큰)이 없는 업체입니다. 계정이 있는 업체로 바꿔서 다시 실행해 주세요.")
        else:
            log(f"샘플 tokenId = {token_id}")

            print("\n[4/6] 게시글 작성 / 목록")
            page.goto(f"{BASE}/karrotFront/write?tokenId={token_id}&businessId={business_id}",
                      wait_until="domcontentloaded")
            results.append(capture(page, "07_write", "게시글 작성 (등록 안 함)"))

            page.goto(f"{BASE}/karrotFront/posts?tokenId={token_id}", wait_until="domcontentloaded")
            results.append(capture(page, "08_posts", "내 게시글 목록"))

            print("\n[5/6] 게시글 상세 (댓글/대댓글)")
            post_id = first_param(page, r"[?&]id=(\d+)")
            if post_id:
                page.goto(
                    f"{BASE}/karrotFront/post?id={post_id}"
                    f"&tokenId={token_id}&businessId={business_id}",
                    wait_until="domcontentloaded",
                )
                results.append(capture(page, "09_post_detail", "게시글 상세 · 댓글 입력바"))
                try_open_modal(page, "답글", "10_reply_form", results)
            else:
                log("게시글이 없어 상세 화면은 건너뜁니다.")

            print("\n[6/6] 후기 관리")
            nick = nickname or ""
            page.goto(
                f"{BASE}/karrotFront/reviews?tokenId={token_id}"
                f"&nickname={nick}&businessId={business_id}",
                wait_until="domcontentloaded",
            )
            results.append(capture(page, "11_reviews", "후기 관리"))

        report = {
            "collectedAt": datetime.now().isoformat(timespec="seconds"),
            "base": BASE,
            "sample": {"businessId": business_id, "tokenId": token_id, "nickname": nickname},
            "pages": results,
        }
        (OUT / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        print(f"\n완료. '{OUT.resolve()}' 폴더가 생성되었습니다.")
        print("  report.json  — 화면별 버튼/입력창 구조 (이 파일만 있으면 됩니다)")
        print("  html/        — 화면별 원본 HTML")
        print("  shot/        — 화면별 스크린샷")
        print("\n브라우저를 닫으면 종료됩니다.")
        input("  엔터를 누르면 브라우저를 닫습니다... ")
        ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
