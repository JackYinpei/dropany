"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("登录失败：邮箱或密码不正确");
    } else {
      router.push("/");
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={onSubmit} style={{ width: 320, padding: 24, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
        <h1 style={{ margin: 0, marginBottom: 16, fontSize: 20 }}>登录</h1>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>邮箱</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #d1d5db", borderRadius: 4 }} />
        <label style={{ display: "block", fontSize: 14, marginBottom: 4 }}>密码</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: "100%", padding: 8, marginBottom: 12, border: "1px solid #d1d5db", borderRadius: 4 }} />
        {error ? <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</div> : null}
        <button type="submit" disabled={loading} style={{ width: "100%", padding: 10, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{loading ? "登录中..." : "登录"}</button>
        <div style={{ marginTop: 12, fontSize: 14 }}>
          没有账号？ <a href="/register" style={{ color: "#3b82f6" }}>去注册</a>
        </div>
      </form>
    </div>
  );
}

