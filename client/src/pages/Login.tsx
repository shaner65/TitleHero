// src/pages/Login.tsx
import React, { useState } from "react";
import axios from 'axios';
import "./Login.css";
import { API_BASE } from "../constants/constants";

type LoginFormData = {
  username: string;
  password: string;
}

export default function Login({ onEnter }: { onEnter: () => void }) {
  const [formData, setFormData] = useState<LoginFormData>({
    username: '',
    password: ''
  });
  const [error, setError] = useState<string>('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    console.log('Login attempt with:', formData);

    try {
      console.log('Sending login request with:', formData);
      
      const response = await axios.post(`${API_BASE}/login`, formData, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      console.log('Server response:', response.data);
      
      if (response.data.success) {
        // Check if user must change password
        if (response.data.mustChangePassword) {
          setUserId(response.data.userId);
          setMustChangePassword(true);
          // Store credentials temporarily for after password change
          localStorage.setItem('token', response.data.token || '');
          localStorage.setItem('role', response.data.role || '');
          localStorage.setItem('username', formData.username);
          return;
        }
        
        localStorage.setItem('token', response.data.token || '');
        localStorage.setItem('role', response.data.role || '');
        localStorage.setItem('username', formData.username);
        onEnter();
      } else {
        throw new Error(response.data.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || 'Could not connect to server');
      } else {
        setError('Invalid username or password');
      }
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePasswordError('');

    if (newPassword.length < 6) {
      setChangePasswordError('Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError('Passwords do not match');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE}/users/change-password`, {
        userId,
        newPassword
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        // Password changed successfully, complete login
        onEnter();
      } else {
        throw new Error(response.data.error || 'Failed to change password');
      }
    } catch (err) {
      console.error('Change password error:', err);
      if (axios.isAxiosError(err)) {
        setChangePasswordError(err.response?.data?.error || 'Failed to change password');
      } else {
        setChangePasswordError('Failed to change password');
      }
    }
  };

  // Password change form
  if (mustChangePassword) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <div className="welcome-head">
            <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="welcome-logo" />
          </div>

          <h1 style={{ margin: 0 }}>Change Your Password</h1>

          <form onSubmit={handleChangePassword} className="welcome-form">
            <div className="field">
              <label>Your password has been reset. Please create a new password to continue.</label>
            </div>

            {changePasswordError && (
              <div className="error-message" style={{ color: 'red', marginBottom: '1rem' }}>
                {changePasswordError}
              </div>
            )}

            <div className="row-2">
              <div className="field">
                <label htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  className="input"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <div className="field">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  className="input"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div className="password-requirements">
              <small>Password must be at least 6 characters</small>
            </div>

            <div className="cta-row">
              <button type="submit" className="btn btn-primary">
                Set New Password
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-head">
          <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="welcome-logo" />
          <div className="ctas">
            {/* <button className="btn" onClick={() => void 0}>Docs</button> */}
          </div>
        </div>

        <h1 style={{ margin: 0 }}>Welcome, USER</h1>

        <form onSubmit={handleSubmit} className="welcome-form">
          <div className="field">
            <label htmlFor="org">Every title needs a hero.</label>
          </div>

          {error && (
            <div className="error-message" style={{ color: 'red', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <div className="row-2">
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                className="input"
                placeholder="<your username>"
                value={formData.username}
                onChange={handleChange}
                autoComplete="username"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                className="input"
                placeholder="<your password>"
                value={formData.password}
                onChange={handleChange}
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <div className="cta-row">
            <button className="btn" onClick={() => void 0}>
              Help
            </button>
            <button type="submit" className="btn btn-primary">
              Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
