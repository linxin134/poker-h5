import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; info: string | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
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
          <p style={{ margin: 0, color: "#ff8c8c", fontSize: "14px", maxWidth: "360px", wordBreak: "break-all" }}>
            {this.state.error?.message ?? "未知错误"}
          </p>
          {this.state.info && <pre style={{
            margin: 0, padding: "10px", borderRadius: "8px",
            background: "#0b1b22", color: "#91a1a7", fontSize: "11px",
            maxWidth: "360px", maxHeight: "200px", overflow: "auto",
            textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-all"
          }}>{this.state.info.slice(0, 1500)}</pre>}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => { this.setState({ hasError: false, error: null, info: null }); }}
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
        </div>
      );
    }
    return this.props.children;
  }
}
