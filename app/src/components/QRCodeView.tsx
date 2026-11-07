import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeViewProps {
  value: string;
  title?: string;
  subtitle?: string;
  size?: number;
}

export function QRCodeView({ value, title, subtitle, size = 180 }: QRCodeViewProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then(setDataUrl)
      .catch((err) => console.error('Failed to generate QR code', err));
  }, [value, size]);

  const copyCode = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="qr-container">
      {title && <h3 className="qr-title">{title}</h3>}
      {dataUrl ? (
        <img className="qr-image" src={dataUrl} alt={`QR Code for ${value}`} width={size} height={size} />
      ) : (
        <div className="qr-placeholder" style={{ width: size, height: size }}>
          Membuat QR...
        </div>
      )}
      <div className="qr-code-row">
        <code className="qr-code-text">{value}</code>
        <button type="button" className="secondary qr-copy-btn" onClick={copyCode}>
          {copied ? 'Tersalin!' : 'Salin'}
        </button>
      </div>
      {subtitle && <small className="qr-subtitle">{subtitle}</small>}
    </div>
  );
}
