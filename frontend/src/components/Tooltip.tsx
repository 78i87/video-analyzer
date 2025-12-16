import { useState, type ReactNode } from "react";

type Props = {
  content?: string | null;
  children: ReactNode;
  className?: string;
};

export default function Tooltip({ content, children, className }: Props) {
  const [visible, setVisible] = useState(false);
  const safe = content ? String(content) : "";

  if (!safe) {
    return <>{children}</>;
  }

  return (
    <div
      className={`tooltip-wrapper ${visible ? 'tooltip-visible' : ''} ${className ?? ""}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <span className="tooltip-bubble" role="tooltip">
        {safe}
      </span>
    </div>
  );
}
