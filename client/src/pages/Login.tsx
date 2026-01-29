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

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-head">
          <div className="logo-tag">TITLEHERO</div>
          <img src="/TITLE HERO TRANSPARENT LOGO.png" alt="Title Hero" className="welcome-logo" />
          <div className="ctas">
            <button className="btn" onClick={() => void 0}>Docs</button>
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
