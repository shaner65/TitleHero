import { useEffect, useState } from "react";
import { isAdmin } from "../utils/auth";
import { API_BASE } from "../constants/constants";
import "./Admin.css";

interface User {
  userID: number;
  name: string;
  role: string;
}

interface County {
  countyID: number;
  name: string;
  effectiveDate?: string | null;
}

interface GapReport {
  gaps: number[];
  minId: number;
  maxId: number;
  totalGaps: number;
  totalRange: number;
  totalDocs?: number;
  limited?: boolean;
  showing?: number;
}

export default function Admin({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [counties, setCounties] = useState<County[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddCounty, setShowAddCounty] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", password: "", role: "user" });
  const [newCounty, setNewCounty] = useState({ name: "", effectiveDate: "" });
  const [createError, setCreateError] = useState("");
  const [createCountyError, setCreateCountyError] = useState("");
  const [editingCountyId, setEditingCountyId] = useState<number | null>(null);
  const [editingEffectiveDate, setEditingEffectiveDate] = useState("");
  const [updateCountyError, setUpdateCountyError] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; countyId: number | null; newDate: string }>({
    show: false,
    countyId: null,
    newDate: ""
  });
  const [gapReport, setGapReport] = useState<GapReport | null>(null);
  const [loadingGapReport, setLoadingGapReport] = useState(false);
  const [gapReportError, setGapReportError] = useState("");
  const [resetPasswordDialog, setResetPasswordDialog] = useState<{ show: boolean; user: User | null }>({ show: false, user: null });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetPasswordError, setResetPasswordError] = useState("");

  const fetchUsers = () => {
    fetch(`${API_BASE}/users`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'x-username': localStorage.getItem('username') || ''
      }
    })
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setUsers(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  };

  const fetchCounties = () => {
    fetch(`${API_BASE}/county`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch counties: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setCounties(data);
      })
      .catch(err => {
        console.error('Failed to fetch counties:', err);
      });
  };

  useEffect(() => {
    // Check admin access
    if (!isAdmin()) {
      setError("Access denied. Admin privileges required.");
      setLoading(false);
      return;
    }

    fetchUsers();
    fetchCounties();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");

    try {
      const res = await fetch(`${API_BASE}/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          username: newUser.name,
          password: newUser.password,
          isAdmin: newUser.role === "admin",
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create user: ${text}`);
      }

      // Reset form and refresh users
      setNewUser({ name: "", password: "", role: "user" });
      setShowAddUser(false);
      fetchUsers();
    } catch (err: any) {
      setCreateError(err.message || "Failed to create user");
    }
  };

  const handleCreateCounty = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateCountyError("");

    try {
      const res = await fetch(`${API_BASE}/county`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: newCounty.name.trim(),
          effectiveDate: newCounty.effectiveDate || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || `Failed to create county: ${res.status}`);
      }

      // Reset form and refresh counties
      setNewCounty({ name: "", effectiveDate: "" });
      setShowAddCounty(false);
      fetchCounties();
    } catch (err: any) {
      setCreateCountyError(err.message || "Failed to create county");
    }
  };

  const handleDateChange = (countyId: number, newDate: string) => {
    const currentCounty = counties.find(c => c.countyID === countyId);
    const currentDate = formatDateForInput(currentCounty?.effectiveDate);
    
    // Only show confirmation if date actually changed
    if (newDate !== currentDate && newDate !== "") {
      setConfirmDialog({
        show: true,
        countyId,
        newDate
      });
    }
  };

  const handleConfirmUpdate = async () => {
    const { countyId, newDate } = confirmDialog;
    if (!countyId) return;

    setUpdateCountyError("");

    try {
      const res = await fetch(`${API_BASE}/county/${countyId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: counties.find(c => c.countyID === countyId)?.name,
          effectiveDate: newDate || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || `Failed to update county: ${res.status}`);
      }

      // Reset and refresh
      setConfirmDialog({ show: false, countyId: null, newDate: "" });
      setEditingCountyId(null);
      setEditingEffectiveDate("");
      fetchCounties();
    } catch (err: any) {
      setUpdateCountyError(err.message || "Failed to update effective date");
    }
  };

  const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Extract just the date part (YYYY-MM-DD) to avoid timezone conversion
    return dateString.split('T')[0];
  };

  const fetchGapReport = async () => {
    setLoadingGapReport(true);
    setGapReportError("");
    try {
      const res = await fetch(`${API_BASE}/users/gap-report`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'x-username': localStorage.getItem('username') || ''
        }
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch gap report: ${res.status}`);
      }
      const data = await res.json();
      setGapReport(data);
    } catch (err: any) {
      setGapReportError(err.message || "Failed to generate gap report");
    } finally {
      setLoadingGapReport(false);
    }
  };

  if (!isAdmin()) {
    return (
      <div className="admin-page">
        <div className="admin-container">
          <h1>Access Denied</h1>
          <p>You must be an administrator to view this page.</p>
          <button className="btn" onClick={onBack}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-header">
          <h1>Admin Panel</h1>
          <button className="btn" onClick={onBack}>Back to Dashboard</button>
        </div>

        {loading && <p>Loading...</p>}
        {error && <p className="error">{error}</p>}

        {/* Gap Report Section */}
        <div className="admin-section">
          <div className="section-header">
            <h2>Gap Report</h2>
            <button 
              className="btn btn-primary" 
              onClick={fetchGapReport}
              disabled={loadingGapReport}
            >
              {loadingGapReport ? 'Generating...' : 'Find Missing Documents'}
            </button>
          </div>
          {gapReportError && <p className="error">{gapReportError}</p>}
        </div>

        {/* User Management Section */}
        <div className="admin-section">
          <div className="section-header">
            <h2>User Management</h2>
            <button className="btn btn-primary" onClick={() => setShowAddUser(!showAddUser)}>
              {showAddUser ? 'Cancel' : 'Add User'}
            </button>
          </div>

          {showAddUser && (
            <div className="add-user-form">
              <h3>Create New User</h3>
              {createError && <p className="error">{createError}</p>}
              <form onSubmit={handleCreateUser}>
                <div className="form-group">
                  <label>Username:</label>
                  <input
                    type="text"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Password:</label>
                  <input
                    type="password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Role:</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary">Create User</button>
              </form>
            </div>
          )}

          {!loading && !error && (
            <div className="users-table-container">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Username</th>
                    <th>
                      <span className="role-header">
                        Role
                        <span className="role-help-icon">?
                          <div className="role-tooltip">
                            <div className="tooltip-section">
                              <strong><span className="role-badge user">User</span></strong>
                              <ul>
                                <li>Search documents</li>
                                <li>View document PDFs</li>
                                <li>Generate AI summaries</li>
                                <li>Save and load searches</li>
                                <li>Generate Chain of Title reports</li>
                              </ul>
                            </div>
                            <div className="tooltip-section">
                              <strong><span className="role-badge admin">Admin</span></strong>
                              <ul>
                                <li><em>All User permissions, plus:</em></li>
                                <li>Access Admin Panel</li>
                                <li>Create and manage users</li>
                                <li>Manage counties</li>
                                <li>Upload documents</li>
                                <li>Edit/Delete documents</li>
                                <li>Run gap reports</li>
                              </ul>
                            </div>
                          </div>
                        </span>
                      </span>
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.userID}>
                      <td>{user.userID}</td>
                      <td>{user.name}</td>
                      <td>
                        <span className={`role-badge ${user.role}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-small btn-reset"
                          onClick={() => {
                            setResetPasswordDialog({ show: true, user });
                            setTempPassword(null);
                            setResetPasswordError("");
                          }}
                        >
                          Reset Password
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <p className="no-users">No users found</p>}
            </div>
          )}

          {/* Reset Password Dialog */}
          {resetPasswordDialog.show && resetPasswordDialog.user && (
            <div className="modal-overlay">
              <div className="modal-content">
                {!tempPassword ? (
                  <>
                    <h3>Reset Password</h3>
                    <p>Are you sure you want to reset the password for <strong>{resetPasswordDialog.user.name}</strong>?</p>
                    <p className="warning-text">A temporary password will be generated. The user will be required to change it on their next login.</p>
                    {resetPasswordError && <p className="error">{resetPasswordError}</p>}
                    <div className="modal-actions">
                      <button className="btn" onClick={() => setResetPasswordDialog({ show: false, user: null })}>
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-danger"
                        onClick={async () => {
                          try {
                            const res = await fetch(`${API_BASE}/users/${resetPasswordDialog.user!.userID}/reset-password`, {
                              method: 'POST',
                              headers: {
                                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                                'x-username': localStorage.getItem('username') || ''
                              }
                            });
                            if (!res.ok) {
                              const data = await res.json();
                              throw new Error(data.error || 'Failed to reset password');
                            }
                            const data = await res.json();
                            setTempPassword(data.tempPassword);
                          } catch (err) {
                            setResetPasswordError(err instanceof Error ? err.message : 'Failed to reset password');
                          }
                        }}
                      >
                        Reset Password
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Password Reset Successful</h3>
                    <p>Temporary password for <strong>{resetPasswordDialog.user.name}</strong>:</p>
                    <div className="temp-password-display">
                      <code>{tempPassword}</code>
                      <button
                        className="btn-small"
                        onClick={() => {
                          navigator.clipboard.writeText(tempPassword);
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <p className="warning-text">Please share this password securely with the user. They will be required to change it on their next login.</p>
                    <div className="modal-actions">
                      <button className="btn btn-primary" onClick={() => setResetPasswordDialog({ show: false, user: null })}>
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* County Management Section */}
        <div className="admin-section">
          <div className="section-header">
            <h2>County Management</h2>
            <button className="btn btn-primary" onClick={() => setShowAddCounty(!showAddCounty)}>
              {showAddCounty ? 'Cancel' : 'Add County'}
            </button>
          </div>

          {showAddCounty && (
            <div className="add-user-form">
              <h3>Create New County</h3>
              {createCountyError && <p className="error">{createCountyError}</p>}
              <form onSubmit={handleCreateCounty}>
                <div className="form-group">
                  <label>County Name:</label>
                  <input
                    type="text"
                    value={newCounty.name}
                    onChange={(e) => setNewCounty({ ...newCounty, name: e.target.value })}
                    placeholder="e.g., Washington"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Effective Date (Last Recording Date):</label>
                  <input
                    type="date"
                    value={newCounty.effectiveDate}
                    onChange={(e) => setNewCounty({ ...newCounty, effectiveDate: e.target.value })}
                  />
                </div>
                <button type="submit" className="btn btn-primary">Create County & S3 Folder</button>
              </form>
            </div>
          )}

          <div className="users-table-container">
            {updateCountyError && <p className="error">{updateCountyError}</p>}
            <table className="users-table">
              <thead>
                <tr>
                  <th>County ID</th>
                  <th>Name</th>
                  <th>Effective Date</th>
                </tr>
              </thead>
              <tbody>
                {counties.map(county => (
                  <tr key={county.countyID}>
                    <td>{county.countyID}</td>
                    <td>{county.name}</td>
                    <td>
                      {editingCountyId === county.countyID ? (
                        <input
                          type="date"
                          value={editingEffectiveDate || formatDateForInput(county.effectiveDate)}
                          onChange={(e) => {
                            const newDate = e.target.value;
                            setEditingEffectiveDate(newDate);
                          }}
                          onBlur={() => {
                            if (editingEffectiveDate && editingEffectiveDate !== formatDateForInput(county.effectiveDate)) {
                              handleDateChange(county.countyID, editingEffectiveDate);
                            } else {
                              setEditingCountyId(null);
                              setEditingEffectiveDate("");
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (editingEffectiveDate && editingEffectiveDate !== formatDateForInput(county.effectiveDate)) {
                                handleDateChange(county.countyID, editingEffectiveDate);
                              } else {
                                setEditingCountyId(null);
                                setEditingEffectiveDate("");
                              }
                            }
                          }}
                          autoFocus
                          className="editable-date-input"
                        />
                      ) : (
                        <span
                          onClick={() => {
                            setEditingCountyId(county.countyID);
                            setEditingEffectiveDate(formatDateForInput(county.effectiveDate));
                          }}
                          className="editable-date-cell"
                        >
                          {county.effectiveDate ? new Date(county.effectiveDate).toLocaleDateString() : '1/1/1900'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {counties.length === 0 && <p className="no-users">No counties found</p>}
          </div>
        </div>

        {/* Confirmation Modal */}
        {confirmDialog.show && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Confirm Effective Date Change</h3>
              <p>Are you sure you want to change the effective date?</p>
              <p style={{ fontSize: '0.9rem', color: '#666' }}>
                New date: <strong>
                  {(() => {
                    const [year, month, day] = confirmDialog.newDate.split('-');
                    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    return date.toLocaleDateString();
                  })()}
                </strong>
              </p>
              <div className="modal-buttons">
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmUpdate}
                >
                  Confirm
                </button>
                <button
                  className="btn btn-cancel"
                  onClick={() => {
                    setConfirmDialog({ show: false, countyId: null, newDate: "" });
                    setEditingCountyId(null);
                    setEditingEffectiveDate("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Gap Report Modal */}
        {gapReport && (
          <div className="modal-overlay" onClick={() => setGapReport(null)}>
            <div className="modal-content gap-report-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Missing Document IDs</h3>
              <div className="gap-report-summary">
                <p><strong>Range:</strong> {gapReport.minId} to {gapReport.maxId} ({gapReport.totalRange.toLocaleString()} total)</p>
                {gapReport.totalDocs && <p><strong>Documents:</strong> {gapReport.totalDocs.toLocaleString()}</p>}
                <p><strong>Missing:</strong> {gapReport.totalGaps.toLocaleString()} document{gapReport.totalGaps !== 1 ? 's' : ''}</p>
                {gapReport.limited && (
                  <p style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    ⚠ Showing first {gapReport.showing?.toLocaleString()} of {gapReport.totalGaps.toLocaleString()} gaps
                  </p>
                )}
              </div>
              {gapReport.totalGaps > 0 ? (
                <div className="gap-list-container">
                  <div className="gap-list">
                    {gapReport.gaps.map((id) => (
                      <span key={id} className="gap-id">{id}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: '#10b981', fontWeight: 600 }}>
                  ✓ No gaps found! All document IDs are sequential.
                </p>
              )}
              <div className="modal-buttons">
                <button
                  className="btn btn-primary"
                  onClick={() => setGapReport(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}