import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./table-seats.css";
import "./table-action.css";

declare const __APP_RELEASE__: string;

const releaseStorageKey = "poker-loaded-release";
const previousRelease = window.sessionStorage.getItem(releaseStorageKey);
window.sessionStorage.setItem(releaseStorageKey, __APP_RELEASE__);
document.documentElement.dataset.release = __APP_RELEASE__;

if (previousRelease && previousRelease !== __APP_RELEASE__) {
  window.location.replace(`${window.location.pathname}?v=${encodeURIComponent(__APP_RELEASE__)}`);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
