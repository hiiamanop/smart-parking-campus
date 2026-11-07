import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrImageProps {
  value: string;
  size?: number;
}

export function QrImage({ value, size = 180 }: QrImageProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, { width: size, margin: 2, color: { dark: '#002e5d', light: '#ffffff' } })
      .then(setSrc)
      .catch((err) => console.warn('QR generation failed', err));
  }, [value, size]);

  if (!src) {
    return <div className="qr-placeholder" style={{ width: size, height: size }} />;
  }
  return <img className="qr-image" src={src} alt={`QR ${value}`} width={size} height={size} />;
}
