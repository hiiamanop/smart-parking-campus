import { useState } from 'react';
import type { Domain, Zone } from '../../types';
import { createDomainApi, updateDomainApi, deleteDomainApi } from '../../lib/api';

interface DomainManagerProps {
  domains: Domain[];
  zones: Zone[];
  onRefresh: () => void;
}

export function DomainManager({ domains, zones, onRefresh }: DomainManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const openEdit = (d: Domain) => {
    setEditing(d);
    setName(d.name);
    setDescription(d.description || '');
    setShowForm(true);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (editing) {
        await updateDomainApi(editing.id, { name, description });
        setSuccess(`Domain "${name}" berhasil diperbarui.`);
      } else {
        await createDomainApi({ name, description });
        setSuccess(`Domain "${name}" berhasil ditambahkan.`);
      }
      setShowForm(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (d: Domain) => {
    if (!confirm(`Hapus domain "${d.name}"?`)) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteDomainApi(d.id);
      setSuccess(`Domain "${d.name}" berhasil dihapus.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-zone-manager">
      <div className="section-header row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Domain parkir</h2>
          <p className="hint-text" style={{ margin: 0 }}>
            Kelompokkan zona berdasarkan domain area. Setiap zona terikat ke satu domain.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (showForm && !editing ? setShowForm(false) : openAdd())}
        >
          {showForm && !editing ? 'Tutup form' : '+ Tambah domain'}
        </button>
      </div>

      {error && <div className="alert alert-err">{error}</div>}
      {success && <div className="alert alert-ok">{success}</div>}

      {showForm && (
        <section className="card mb-4" style={{ borderLeft: '3px solid var(--accent)' }}>
          <h3>{editing ? `Edit domain: ${editing.name}` : 'Domain baru'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>
                  Nama domain
                  <input
                    type="text"
                    placeholder="Contoh: Teknik"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="form-group">
                <label>
                  Deskripsi
                  <input
                    type="text"
                    placeholder="Contoh: Area Fakultas Teknik"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="row" style={{ marginTop: 6 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Buat domain'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditing(null);
                }}
              >
                Batal
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nama domain</th>
                <th>Deskripsi</th>
                <th>Zona terikat</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {domains.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint-text" style={{ textAlign: 'center', padding: 20 }}>
                    Belum ada domain.
                  </td>
                </tr>
              )}
              {domains.map((d) => {
                const zoneCount = zones.filter((z) => z.domainId === d.id).length;
                return (
                  <tr key={d.id}>
                    <td>
                      <code>{d.id}</code>
                    </td>
                    <td>
                      <strong>{d.name}</strong>
                    </td>
                    <td>{d.description || <span className="hint-text">—</span>}</td>
                    <td>{zoneCount} zona</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button type="button" className="secondary btn-sm" onClick={() => openEdit(d)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-sm chip-warn"
                          style={{ border: 'none', cursor: 'pointer' }}
                          onClick={() => handleDelete(d)}
                          disabled={loading}
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
