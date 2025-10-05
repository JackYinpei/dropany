"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "注册失败");
      }
      setSuccess("注册成功，自动登录中...");
      const sign = await signIn("credentials", { email, password, redirect: false });
      if (sign?.error) {
        setSuccess("");
        setError("登录失败，请手动登录");
      } else {
        router.push("/");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={onSubmit} style={{ width: 320, padding: 24, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
        <h1 style={{ margin: 0, marginBottom: 16, fontSize: 20 }}>注册</h1>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>邮箱</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #d1d5db", borderRadius: 4 }} />
        <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>密码</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #d1d5db", borderRadius: 4 }} />
        {error ? <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</div> : null}
        {success ? <div style={{ color: "#16a34a", fontSize: 13, marginBottom: 12 }}>{success}</div> : null}
        <button type="submit" disabled={loading} style={{ width: "100%", padding: 10, background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{loading ? "提交中..." : "注册并登录"}</button>
        <div style={{ marginTop: 12, fontSize: 14 }}>
          已有账号？ <a href="/login" style={{ color: "#3b82f6" }}>去登录</a>
        </div>
      </form>
    </div>
  );
}

