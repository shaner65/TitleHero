import { useEffect, useState } from "react";
import { isAdmin } from "../utils/auth";
import "./Admin.css";

const API_BASE = import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_TARGET || 'https://5mj0m92f17.execute-api.us-east-2.amazonaws.com/api');

interface User {
  userID: number;
  name: string;
  role: string;
}

export default function Admin({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", password: "", role: "user" });
  const [createError, setCreateError] = useState("");

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

  useEffect(() => {
    // Check admin access
    if (!isAdmin()) {
      setError("Access denied. Admin privileges required.");
      setLoading(false);
      return;
    }

    fetchUsers();
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
          <h1>User Management</h1>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-primary" onClick={() => setShowAddUser(!showAddUser)}>
              {showAddUser ? 'Cancel' : 'Add User'}
            </button>
            <button className="btn" onClick={onBack}>Back to Dashboard</button>
          </div>
        </div>

        {loading && <p>Loading users...</p>}
        {error && <p className="error">{error}</p>}

        {showAddUser && (
          <div className="add-user-form">
            <h2>Create New User</h2>
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
    </div>
  );
}
