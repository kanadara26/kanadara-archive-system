import { useEffect } from 'react';

// 방향키로 입력창·버튼 사이를 이동하고, 입력창에서 Enter를 누르면 다음 칸으로 넘어감.
// 화살표를 자체적으로 쓰는 곳(textarea, select, 검색 드롭다운)은 data-arrow-nav="off"로 제외.
const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]):not([readonly]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const TEXT_TYPES = new Set(['text', 'search', 'tel', 'email', 'password', 'url', '']);

function focusables(root: Element): HTMLElement[] {
  // data-nav-skip: 입력 흐름 중간에 끼어 있는 보조 버튼(간편 등록 링크 등)은 건너뜀 (Tab으로는 여전히 이동 가능)
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.hasAttribute('data-nav-skip')
  );
}

/** 화면 순서상 다음 입력칸/버튼으로 포커스 이동 (선택 후 자동 넘어가기용) */
export function focusNext(from: HTMLElement) {
  const list = focusables(from.closest('[role="dialog"], header, main') || document.body);
  const next = list[list.indexOf(from) + 1];
  next?.focus();
}

export function useArrowKeyNavigation() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (!t || t.closest('[data-arrow-nav="off"]')) return;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;

      const isInput = tag === 'INPUT';
      const input = t as HTMLInputElement;
      const inputType = isInput ? input.type : '';
      const isTextLike = isInput && TEXT_TYPES.has(inputType);
      const isToggle = isInput && (inputType === 'checkbox' || inputType === 'radio');

      let dir = 0;
      if (e.key === 'ArrowDown') dir = 1;
      else if (e.key === 'ArrowUp') dir = -1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const step = e.key === 'ArrowRight' ? 1 : -1;
        if (!isInput || isToggle) dir = step;
        else if (isTextLike) {
          // 글자 사이 커서 이동은 그대로, 맨 끝/맨 앞에서만 칸 이동
          const atEdge =
            input.selectionStart === input.selectionEnd &&
            (step === 1 ? input.selectionEnd === input.value.length : input.selectionStart === 0);
          if (atEdge) dir = step;
        }
      } else if (e.key === 'Enter' && isInput && !isToggle) {
        dir = 1;
      }
      if (!dir) return;

      // 날짜·숫자 입력은 위/아래 화살표로 값을 바꾸므로 그대로 둠
      if (isInput && !isTextLike && !isToggle && e.key !== 'Enter') return;

      const root = t.closest('[role="dialog"], header, main') || document.body;
      const list = focusables(root);
      const idx = list.indexOf(t);
      if (idx === -1) return;
      const next = list[idx + dir];
      if (!next) return;
      // 마지막 입력칸에서 Enter → 제출 버튼이면 원래대로 제출되게 둠
      if (e.key === 'Enter' && next instanceof HTMLButtonElement && next.type === 'submit') return;
      e.preventDefault();
      next.focus();
      if (next instanceof HTMLInputElement && TEXT_TYPES.has(next.type)) next.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
