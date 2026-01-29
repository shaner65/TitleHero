import { useState } from "react";
import { API_BASE } from "../../../constants/constants";
import type { AdminFormData } from "./types";

export function AdminSignupForm() {
  const [form, setForm] = useState<AdminFormData>({
    name: "",
    password: "",
    role: "admin",
    permissions: [],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      console.log("Submitting signup form:", form);
      const res = await fetch(`${API_BASE}/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          username: form.name,
          password: form.password,
          isAdmin: form.role === "admin" ? true : false,
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Server ${res.status}: ${t}`);
      }

      const data = await res.json();
      console.log("Signup success:", data);

      setForm({
        name: "",
        password: "",
        role: "user",
        permissions: [],
      });

    } catch (e: any) {
      console.error(e?.message || "Signup failed");
    }
  };

  return (
    <div className="signup-container">
      <h2 >Add Users</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Username: </label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/>
        </div>

        <div>
          <label>Password: </label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required/>
        </div>

        <div>
          <label>Role: </label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button type="submit">
          Create User
        </button>
      </form>
    </div>
  );
}