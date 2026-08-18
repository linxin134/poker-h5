import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          display: "grid", placeItems: "center", width: "100%", height: "100%",
          background: "#061018", color: "#f5f1e8", fontFamily: "system-ui",
          padding: "20px", textAlign: "center", gap: "12px"
        }}>
          <div style={{ fontSize: "48px" }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: "20px" }}>页面遇到了问题</h2>
          <p style={{ margin: 0, color: "#91a1a7", fontSize: "14px", maxWidth: "320px" }}>
            {this.state.error?.message ?? "未知错误"}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{
              padding: "8px 20px", border: "1px solid #ffffff28", borderRadius: "999px",
              background: "transparent", color: "#d8e0df", cursor: "pointer", fontSize: "14px"
            }}
          >
            重试
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            style={{
              padding: "8px 20px", border: "0", borderRadius: "8px",
              background: "#3f7b69", color: "#fff", cursor: "pointer", fontSize: "14px"
            }}
          >
            返回大厅
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
