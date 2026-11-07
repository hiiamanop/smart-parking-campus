import { useState } from 'react';
import type { Faculty, Zone } from '../../types';
import { QRCodeView } from '../QRCodeView';

interface ZoneQRGeneratorProps {
  faculties: Faculty[];
  zones: Zone[];
}

export function ZoneQRGenerator({ faculties, zones }: ZoneQRGeneratorProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string>('all');

  const filteredZones = selectedZoneId === 'all'
    ? zones
    : zones.filter((z) => z.id === selectedZoneId);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="admin-qr-generator">
      <div className="section-header row no-print" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2>Generate &amp; Cetak QR Code Tiang Zona Fisik</h2>
          <p className="hint-text" style={{ margin: 0 }}>
            Cetak lembar QR code untuk ditempel pada papan/tiang fisik di masing-masing zona parkir outdoor kampus.
          </p>
        </div>
        <div className="row">
          <select
            value={selectedZoneId}
            onChange={(e) => setSelectedZoneId(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">Semua Zona ({zones.length})</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            🖨️ Cetak / Print Lembar QR
          </button>
        </div>
      </div>

      <div className="printable-qr-grid">
        {filteredZones.map((z) => {
          const faculty = faculties.find((f) => f.id === z.facultyId);
          const qrPayload = `CAMPUS-ZONE-${z.id}`;
          return (
            <div key={z.id} className="qr-signpost-plate card">
              <div className="plate-campus-header">
                <span className="plate-univ-name">UNIVERSITAS SMART CAMPUS</span>
                <span className="plate-sub">SISTEM PARKIR OUTDOOR RESMI</span>
              </div>
              <div className="plate-zone-banner">
                <h2 className="plate-zone-title">{z.name}</h2>
                <span className="plate-faculty">{faculty?.name || z.facultyId}</span>
              </div>
              <div className="plate-qr-center">
                <QRCodeView
                  value={qrPayload}
                  size={200}
                />
              </div>
              <div className="plate-instructions">
                <p><strong>PETUNJUK PENGEMUDI:</strong></p>
                <ol>
                  <li>Pindai QR saat tiba di zona untuk <strong>Konfirmasi Parkir</strong>.</li>
                  <li>Pindai kembali saat akan pulang untuk <strong>Mulai Checkout &amp; Bayar</strong>.</li>
                </ol>
                <small className="plate-code-badge">KODE TIANG: {z.id} • Kapasitas: {z.capacity} slot</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
