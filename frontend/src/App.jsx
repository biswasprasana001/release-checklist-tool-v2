import React, { useState, useEffect } from 'react';

const STEPS = [
  'All relevant GitHub pull requests have been merged',
  'CHANGELOG.md files have been updated',
  'All tests are passing',
  'Releases in Github created',
  'Deployed in demo',
  'Tested thoroughly in demo',
  'Deployed in production'
];

async function gql(query, variables = {}) {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

function formatDate(str) {
  if (!str) return '';
  const parts = str.split('-');
  if (parts.length !== 3) return str;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function App() {
  const [releases, setReleases] = useState([]);
  const [current, setCurrent] = useState(null); // null = list view, object = detail/create view
  const [loading, setLoading] = useState(true);

  const loadReleases = async () => {
    try {
      const data = await gql(`query { releases { id name date status additionalInfo completedSteps } }`);
      setReleases(data.releases);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReleases(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!current.name.trim() || !current.date) return alert('Name and Date are required');
    try {
      if (current.id) {
        await gql(`
          mutation ($id: ID!, $name: String, $date: String, $additionalInfo: String, $completedSteps: [Int!]) {
            updateRelease(id: $id, name: $name, date: $date, additionalInfo: $additionalInfo, completedSteps: $completedSteps) { id }
          }
        `, {
          id: current.id,
          name: current.name,
          date: current.date,
          additionalInfo: current.additionalInfo,
          completedSteps: current.completedSteps || []
        });
      } else {
        await gql(`
          mutation ($name: String!, $date: String!, $additionalInfo: String, $completedSteps: [Int!]) {
            createRelease(name: $name, date: $date, additionalInfo: $additionalInfo, completedSteps: $completedSteps) { id }
          }
        `, {
          name: current.name,
          date: current.date,
          additionalInfo: current.additionalInfo,
          completedSteps: current.completedSteps || []
        });
      }
      await loadReleases();
      setCurrent(null);
    } catch (err) {
      alert('Failed to save release: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this release?')) return;
    try {
      await gql(`mutation ($id: ID!) { deleteRelease(id: $id) }`, { id });
      await loadReleases();
      if (current && current.id === id) setCurrent(null);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const toggleStep = (idx) => {
    const steps = current.completedSteps || [];
    const nextSteps = steps.includes(idx) ? steps.filter(i => i !== idx) : [...steps, idx];
    setCurrent({ ...current, completedSteps: nextSteps });
  };

  return (
    <div className="page-wrapper">
      <header className="page-header">
        <h1>ReleaseCheck</h1>
        <p>Your all-in-one release checklist tool</p>
      </header>

      <main className="card-box">
        {!current ? (
          /* SCREEN 1: ALL RELEASES LIST */
          <div className="list-screen">
            <div className="card-topbar">
              <span className="tab-active">All releases</span>
              <button
                className="btn-primary"
                onClick={() => setCurrent({ name: '', date: new Date().toISOString().slice(0, 10), additionalInfo: '', completedSteps: [] })}
              >
                New release <span className="icon-plus">+</span>
              </button>
            </div>

            <div className="table-responsive">
              <table className="release-table">
                <thead>
                  <tr>
                    <th>Release</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="5" className="text-center">Loading releases...</td></tr>
                  ) : releases.length === 0 ? (
                    <tr><td colSpan="5" className="text-center">No releases found. Click "New release +" to add one.</td></tr>
                  ) : (
                    releases.map((r) => (
                      <tr key={r.id}>
                        <td className="col-name">{r.name}</td>
                        <td className="col-date">{formatDate(r.date)}</td>
                        <td className="col-status">
                          <span className={`badge badge-${r.status.toLowerCase()}`}>{r.status}</span>
                        </td>
                        <td className="col-action">
                          <button className="link-action" onClick={() => setCurrent(r)}>
                            View <span className="icon">👁</span>
                          </button>
                        </td>
                        <td className="col-action">
                          <button className="link-action" onClick={() => handleDelete(r.id)}>
                            Delete <span className="icon">🗑</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* SCREEN 2: ADD / UPDATE RELEASE */
          <form className="detail-screen" onSubmit={handleSave}>
            <div className="card-topbar">
              <div className="breadcrumb">
                <a href="#back" onClick={(e) => { e.preventDefault(); setCurrent(null); }}>All releases</a>
                <span className="breadcrumb-separator">&gt;</span>
                <span className="breadcrumb-current">{current.id ? current.name || 'Edit release' : 'New release'}</span>
              </div>
              {current.id && (
                <button type="button" className="btn-primary btn-delete" onClick={() => handleDelete(current.id)}>
                  Delete <span className="icon">🗑</span>
                </button>
              )}
            </div>

            <div className="form-row-2col">
              <div className="form-group">
                <label>Release</label>
                <input
                  type="text"
                  required
                  value={current.name}
                  onChange={(e) => setCurrent({ ...current, name: e.target.value })}
                  placeholder="e.g. Version 1.0.1"
                />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  required
                  value={current.date}
                  onChange={(e) => setCurrent({ ...current, date: e.target.value })}
                />
              </div>
            </div>

            <div className="checklist-group">
              {STEPS.map((step, idx) => (
                <label key={idx} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={(current.completedSteps || []).includes(idx)}
                    onChange={() => toggleStep(idx)}
                  />
                  <span>{step}</span>
                </label>
              ))}
            </div>

            <div className="form-group remarks-group">
              <label>Additional remarks / tasks</label>
              <textarea
                rows="4"
                value={current.additionalInfo || ''}
                onChange={(e) => setCurrent({ ...current, additionalInfo: e.target.value })}
                placeholder="Please enter any other important notes for the release"
              />
            </div>

            <div className="form-footer">
              <button type="submit" className="btn-primary">
                Save <span className="icon">✓</span>
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
