import { useEffect, useRef } from 'react';

interface IndeterminateCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  'aria-label'?: string;
}

/** Native checkboxes have no `indeterminate` prop — it can only be set via the DOM node. */
export function IndeterminateCheckbox({ checked, indeterminate = false, onChange, ...rest }: IndeterminateCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="row-select-checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      {...rest}
    />
  );
}
