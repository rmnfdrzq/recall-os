export const isDebugMode = () => {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("debug") === "1" ||
    params.get("debug") === "true" ||
    localStorage.getItem("recallosDebug") === "true" ||
    import.meta.env.VITE_RECALLOS_DEBUG === "true"
  );
};
