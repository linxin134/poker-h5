import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { api, type User } from "../services/api";
import { UiIcon } from "./UiIcon";

export function AuthModal({ onClose, onAuthenticated }: { onClose(): void; onAuthenticated(user: User): void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true); setError("");
    try {
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      const result = mode === "login"
        ? await api.login(email, password)
        : await api.register(email, password, String(form.get("nickname")));
      onAuthenticated(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally { setLoading(false); }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="modal auth-modal" initial={{ y: 30, scale: .96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }} onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button modal-close" onClick={onClose} aria-label="关闭"><UiIcon name="close" /></button>
        <p className="eyebrow">CLOUD PROFILE</p>
        <h2>{mode === "login" ? "欢迎回到牌桌" : "创建你的牌手档案"}</h2>
        <p className="muted">登录后可跨设备同步存档、战绩与个性设置。</p>
        <form onSubmit={submit}>
          {mode === "register" && <label>昵称<input name="nickname" minLength={2} maxLength={20} placeholder="牌桌显示名称" required /></label>}
          <label>邮箱<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
          <label>密码<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} placeholder="至少 8 位" required /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button full" disabled={loading}>{loading ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}</button>
        </form>
        <button className="text-button" onClick={() => { setError(""); setMode(mode === "login" ? "register" : "login"); }}>
          {mode === "login" ? "没有账号？立即注册" : "已有账号？返回登录"}
        </button>
      </motion.section>
    </motion.div>
  );
}
