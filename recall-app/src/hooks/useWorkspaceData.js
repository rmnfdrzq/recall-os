import { useEffect, useRef } from "react";

export function useWorkspaceData({ enabled = true, refreshLocalDocuments, loadSessions }) {
  const refreshRef = useRef(refreshLocalDocuments);
  const loadSessionsRef = useRef(loadSessions);

  useEffect(() => {
    refreshRef.current = refreshLocalDocuments;
    loadSessionsRef.current = loadSessions;
  }, [refreshLocalDocuments, loadSessions]);

  useEffect(() => {
    if (!enabled) return undefined;
    let isMounted = true;
    const loadWorkspaceData = async () => {
      try {
        await refreshRef.current();
        if (!isMounted) return;
        await loadSessionsRef.current();
      } catch (err) {
        console.warn("Workspace initialization failed.", err);
      }
    };
    loadWorkspaceData();
    return () => {
      isMounted = false;
    };
  }, [enabled]);
}
