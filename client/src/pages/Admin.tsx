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
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
                    <th>Role</th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <p className="no-users">No users found</p>}
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
                            handleDateChange(county.countyID, newDate);
                          }}
                          onBlur={() => {
                            setEditingCountyId(null);
                            setEditingEffectiveDate("");
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
                New date: <strong>{new Date(confirmDialog.newDate).toLocaleDateString()}</strong>
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
      </div>
    </div>
  );
}