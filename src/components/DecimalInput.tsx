import React, { useEffect, useState } from 'react';

/** 요율 입력: 숫자·소수점만 남기고, '.5'처럼 점부터 치면 '0.5'로 바꿈 */
export function fixDecimal(raw: string): string {
  const t = raw.replace(/[^0-9.-]/g, '');
  if (t.startsWith('.')) return `0${t}`;
  if (t.startsWith('-.')) return `-0${t.slice(1)}`;
  return t;
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (n: number) => void;
};

/** 숫자 상태와 연결된 요율 입력칸. 입력 중인 '0.' 같은 중간 글자를 지우지 않음 */
export const DecimalInput: React.FC<Props> = ({ value, onChange, ...rest }) => {
  const [text, setText] = useState(String(value));

  // 요율표 자동 선택 등으로 값이 바뀌면 표시도 갱신
  useEffect(() => {
    const shown = parseFloat(text);
    if (!(shown === value || (text === '' && value === 0) || (Number.isNaN(shown) && value === 0))) {
      setText(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = fixDecimal(e.target.value);
        setText(t);
        const n = parseFloat(t);
        onChange(Number.isNaN(n) ? 0 : n);
      }}
    />
  );
};
