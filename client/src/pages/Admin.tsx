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

  useEffect(() => {
    // Check admin access
    if (!isAdmin()) {
      setError("Access denied. Admin privileges required.");
      setLoading(false);
      return;
    }

    // Fetch users
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
  }, []);

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
          <button className="btn" onClick={onBack}>Back to Dashboard</button>
        </div>

        {loading && <p>Loading users...</p>}
        {error && <p className="error">{error}</p>}

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
