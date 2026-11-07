import { useState } from 'react';
import type { Faculty, Zone } from '../../types';
import { createZoneApi, updateZoneApi, deleteZoneApi } from '../../lib/api';

interface ZoneManagerProps {
  faculties: Faculty[];
  zones: Zone[];
  onRefresh: () => void;
}

export function ZoneManager({ faculties, zones, onRefresh }: ZoneManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [facultyId, setFacultyId] = useState(faculties[0]?.id || 'FT');
  const [capacity, setCapacity] = useState(20);
  const [gateIn, setGateIn] = useState('');
  const [gateOut, setGateOut] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleOpenAdd = () => {
    setName('');
    setFacultyId(faculties[0]?.id || 'FT');
    setCapacity(20);
    setGateIn('');
    setGateOut('');
    setEditingZone(null);
    setShowAddForm(true);
    setError(null);
    setSuccess(null);
  };

  const handleOpenEdit = (z: Zone) => {
    setEditingZone(z);
    setName(z.name);
    setFacultyId(z.facultyId);
    setCapacity(z.capacity);
    setGateIn(z.gateIn);
    setGateOut(z.gateOut);
    setShowAddForm(true);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingZone) {
        await updateZoneApi(editingZone.id, {
          name,
          facultyId,
          capacity,
          gateIn,
          gateOut,
        });
        setSuccess(`Zona "${name}" berhasil diperbarui.`);
      } else {
        await createZoneApi({
          name,
          facultyId,
          capacity,
          gateIn,
          gateOut,
        });
        setSuccess(`Zona baru "${name}" berhasil ditambahkan.`);
      }
      setShowAddForm(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (zone: Zone) => {
    if (!confirm(`Yakin ingin menghapus zona "${zone.name}"?`)) return;
    setLoading(true);
    setError(null);
    try {
      await deleteZoneApi(zone.id);
      setSuccess(`Zona "${zone.name}" berhasil dihapus.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-zone-manager">
      <div className="section-header row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2>Manajemen Master Data Zona Parkir</h2>
          <p className="hint-text" style={{ margin: 0 }}>
            Kelola kapasitas, lokasi fakultas terkait, dan gate untuk masing-masing area parkir outdoor.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (showAddForm && !editingZone) setShowAddForm(false);
            else handleOpenAdd();
          }}
        >
          {showAddForm && !editingZone ? 'Tutup Form' : '+ Tambah Zona Baru'}
        </button>
      </div>

      {error && <div className="alert alert-err">{error}</div>}
      {success && <div className="alert alert-ok">{success}</div>}

      {/* Add / Edit Form Modal or Collapsible */}
      {showAddForm && (
        <section className="card mb-4" style={{ borderLeft: '4px solid var(--brand)' }}>
          <h3>{editingZone ? `Edit Zona: ${editingZone.name}` : 'Tambah Zona Parkir Baru'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>
                  Nama Zona:
                  <input
                    type="text"
                    placeholder="Contoh: Zona E - Lapangan Rektorat"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="form-group">
                <label>
                  Fakultas Terkait:
                  <select
                    value={facultyId}
                    onChange={(e) => setFacultyId(e.target.value)}
                  >
                    {faculties.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.id})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  Total Kapasitas Slot:
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                    required
                  />
                </label>
              </div>
              <div className="form-group">
                <label>
                  Titik Gate Masuk:
                  <input
                    type="text"
                    placeholder="Contoh: Gate Utama Masuk"
                    value={gateIn}
                    onChange={(e) => setGateIn(e.target.value)}
                  />
                </label>
              </div>
              <div className="form-group">
                <label>
                  Titik Gate Keluar:
                  <input
                    type="text"
                    placeholder="Contoh: Gate Utama Keluar"
                    value={gateOut}
                    onChange={(e) => setGateOut(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Menyimpan...' : editingZone ? 'Simpan Perubahan' : 'Buat Zona'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingZone(null);
                }}
              >
                Batal
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Zones Table */}
      <section className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID Zona</th>
                <th>Nama Zona</th>
                <th>Fakultas</th>
                <th>Kapasitas</th>
                <th>Terisi</th>
                <th>Sisa Slot</th>
                <th>Gate Terkait</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => {
                const fac = faculties.find((f) => f.id === z.facultyId);
                const percent = Math.round((z.occupied / z.capacity) * 100);
                return (
                  <tr key={z.id}>
                    <td><code>{z.id}</code></td>
                    <td><strong>{z.name}</strong></td>
                    <td>{fac?.name || z.facultyId}</td>
                    <td>{z.capacity} slot</td>
                    <td>{z.occupied} ({percent}%)</td>
                    <td>
                      <span className={`slot-tag ${z.isFull ? 'full' : 'avail'}`}>
                        {z.isFull ? 'PENUH' : `${z.available} Kosong`}
                      </span>
                    </td>
                    <td><small>{z.gateIn} / {z.gateOut}</small></td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          type="button"
                          className="secondary btn-sm"
                          onClick={() => handleOpenEdit(z)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-sm chip-warn"
                          onClick={() => handleDelete(z)}
                          style={{ border: 'none', cursor: 'pointer' }}
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
