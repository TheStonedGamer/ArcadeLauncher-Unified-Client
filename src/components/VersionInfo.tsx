import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

interface VersionInfoProps {
  className?: string;
}

export function VersionInfo({ className = "" }: VersionInfoProps) {
  const [clientVersion, setClientVersion] = useState<string>("Loading...");
  const [serverVersion, setServerVersion] = useState<string>("...");

  useEffect(() => {
    void getVersion().then(setClientVersion).catch(() => setClientVersion("Unknown"));

    // Get server version from Rust backend
    invoke<string>("get_server_version")
      .then(setServerVersion)
      .catch(() => {
        setServerVersion("Unknown");
      });
  }, []);

  return (
    <div className={`version-info ${className}`}>
      <div className="version-info__client">{clientVersion}</div>
      <div className="version-info__server">{serverVersion}</div>
    </div>
  );
}
