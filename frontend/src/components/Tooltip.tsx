import React from "react";

type Props = {
  content?: string | null;
  children: React.ReactNode;
  className?: string;
};

export default function Tooltip({ content, children, className }: Props) {
  const safe = content ? String(content) : "";
  return (
    <div className={`tooltip-wrapper ${className ?? ""}`}>
      {children}
      {safe ? (
        <span className="tooltip-bubble" role="tooltip">
          {safe}
        </span>
      ) : null}
    </div>
  );
}
