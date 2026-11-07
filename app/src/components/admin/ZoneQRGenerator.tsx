import { useState } from 'react';
import type { Domain, Zone } from '../../types';
import { QrImage } from '../QrImage';

interface ZoneQRGeneratorProps {
  domains: Domain[];
  zones: Zone[];
}

export function ZoneQRGenerator({ domains, zones }: ZoneQRGeneratorProps) {
  const [selectedDomainId, setSelectedDomainId] = useState<string>('all');

  const filteredZones = selectedDomainId === 'all'
    ? zones
    : zones.filter((z) => z.domainId === selectedDomainId);

  // Print hanya satu lembar QR lewat iframe terisolasi,
  // supaya dialog cetak tidak ikut membawa seluruh dashboard.
  const printZoneQr = (zoneId: string) => {
    const card = document.querySelector<HTMLElement>(
      `.qr-signpost-plate[data-zone-id="${zoneId}"]`
    );
    if (!card) return;

    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.no-print').forEach((n) => n.remove());
    clone.classList.remove('print-target');

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('\n');

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
    } as CSSStyleDeclaration);
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return;
    }

    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8">${styles}
<style>
  /* Ukuran kertas F5 / Folio: 215 x 330 mm, margin 10 mm */
  @page { size: 215mm 330mm; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 195mm; font-size: 11pt; }
  .qr-signpost-plate {
    border: 3px solid #111;
    border-radius: 10px;
    box-shadow: none;
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 10mm 8mm;
    box-sizing: border-box;
  }
  .plate-campus-header { padding-bottom: 4mm; margin-bottom: 5mm; border-bottom-width: 3px; }
  .plate-univ-name { font-size: 15pt; }
  .plate-sub { font-size: 10pt; }
  .plate-zone-banner { padding: 5mm; margin-bottom: 7mm; }
  .plate-zone-title { font-size: 20pt; }
  .plate-faculty { font-size: 12pt; }
  .plate-qr-center img { width: 62mm; height: 62mm; }
  .plate-instructions { font-size: 10.5pt; margin-top: 7mm; padding-top: 5mm; }
  .plate-instructions ol { margin: 2mm 0 4mm; }
  .plate-code-badge { font-size: 10pt; padding: 2mm 3mm; }
</style></head><body>${clone.outerHTML}</body></html>`);
    doc.close();

    const images = Array.from(doc.images);
    const ready = Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) resolve();
            else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          })
      )
    );

    ready.then(() => {
      const win = frame.contentWindow;
      win?.focus();
      win?.print();
      setTimeout(() => frame.remove(), 2000);
    });
  };

  return (
    <div className="admin-qr-generator">
      <div className="section-header row no-print" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="hint-text" style={{ margin: 0 }}>Domain:</span>
          <select
            value={selectedDomainId}
            onChange={(e) => setSelectedDomainId(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">Semua domain ({zones.length} zona)</option>
            {domains.map((d) => {
              const count = zones.filter((z) => z.domainId === d.id).length;
              return (
                <option key={d.id} value={d.id}>
                  {d.name} ({count} zona)
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="printable-qr-grid">
        {filteredZones.map((z) => {
          const domain = domains.find((d) => d.id === z.domainId);
          const qrPayload = `CAMPUS-ZONE-${z.id}`;
          return (
            <div key={z.id} className="qr-signpost-plate card" data-zone-id={z.id}>
              <div className="plate-campus-header">
                <span className="plate-univ-name">UNIVERSITAS SMART CAMPUS</span>
                <span className="plate-sub">SISTEM PARKIR OUTDOOR RESMI</span>
              </div>
              <div className="plate-zone-banner">
                <h2 className="plate-zone-title">{z.name}</h2>
                <span className="plate-faculty">{domain?.name || z.domainId}</span>
              </div>
              <div className="plate-qr-center">
                <QrImage value={qrPayload} size={512} />
              </div>
              <div className="plate-instructions">
                <p><strong>PETUNJUK PENGEMUDI:</strong></p>
                <ol>
                  <li>Pindai QR saat tiba di zona untuk <strong>Konfirmasi Parkir</strong>.</li>
                  <li>Pindai kembali saat akan pulang untuk <strong>Mulai Checkout &amp; Bayar</strong>.</li>
                </ol>
                <small className="plate-code-badge">
                  KODE ZONA: {z.id} • {z.vehicleType === 'car' ? 'Mobil' : 'Motor'} • Kapasitas: {z.capacity} slot
                </small>
              </div>

              <div className="plate-print-row no-print">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => printZoneQr(z.id)}>
                  Cetak QR zona ini
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
