import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(''); });
    return () => { cancelled = true; };
  }, [value, size]);

  return (
    <div className="qr">
      {src ? <img src={src} width={size} height={size} alt={`QR ${value}`} /> : <div className="qr-placeholder" style={{ width: size, height: size }} />}
      <code>{value}</code>
    </div>
  );
}
