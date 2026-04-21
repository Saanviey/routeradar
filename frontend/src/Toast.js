import React, { useEffect, useState } from 'react';

export default function Toast({ msg, type }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const color = type === 'alert' ? '#f87171' : '#4ade80';
  const bg = type === 'alert' ? 'rgba(248,113,113,0.08)' : 'rgba(74,222,128,0.08)';

  return (
    <div className="toast" style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(40px)',
      borderLeftColor: color,
      background: bg,
    }}>
      <span className="toast-msg">{msg}</span>
    </div>
  );
}
