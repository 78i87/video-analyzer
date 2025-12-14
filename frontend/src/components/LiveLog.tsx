import React, { useEffect, useRef } from "react";

type Props = {
  lines: string[];
};

export default function LiveLog({ lines }: Props) {
  const ref = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="live-log">
      <pre ref={ref} className="log-pre">
        {lines.join("\n")}
      </pre>
    </div>
  );
}
